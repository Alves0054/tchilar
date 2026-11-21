import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Avatar, Icon, UserContext, api, formatCount } from "./core.jsx";
import { CharCount, LiveBadge, VerifiedBadge, pageTone, usePolling } from "./shared.jsx";
import GIFT_ART from "../data/live-gifts-art.json";
import { Select } from "./select.jsx";

// Ícone desenhado de um presente (SVG do próprio Tchilar, em src/data/live-gifts-art.json).
export function GiftIcon({ gift, size = 40 }) {
  const svg = GIFT_ART[gift];
  if (!svg) return <Icon name="star" size={size} />;
  return <img className="gift-icon" src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} width={size} height={size} alt="" aria-hidden="true" />;
}
// Som de aviso dos presentes caros (1 a 8, cada um mais rico do que o anterior). Os browsers só tocam
// depois de a pessoa ter interagido com a página; se não deixarem, segue sem som.
const playGiftSound = level => {
  if (!level) return;
  try { const audio = new Audio(`/sounds/gift-${level}.wav`); audio.volume = 0.8; audio.play().catch(() => {}); } catch { /* sem áudio */ }
};

// ---------------------------------------------------------------------------------------------
// Diretos (lives). Com servidor de vídeo (modo "cdn"): quem emite envia uma vez (WHIP ou OBS) e
// quem vê recebe HLS pela CDN, sem limite prático de espectadores. Sem ele (modo "p2p"): WebRTC
// direto entre quem emite e cada espectador, até 8 pessoas.
// ---------------------------------------------------------------------------------------------
export let pendingHostStream = null; // a fonte aberta no estúdio passa para a sala sem pedir outra vez
export let pendingHostSettings = null;
export const liveDuration = since => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
};
// Espera que o browser junte os caminhos de rede (ICE) para enviar a oferta/resposta completa.
export const waitForIce = (pc, timeout = 3500) => new Promise(resolve => {
  if (pc.iceGatheringState === "complete") return resolve();
  const timer = window.setTimeout(resolve, timeout);
  pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { window.clearTimeout(timer); resolve(); } });
});
export const sendSignal = (liveId, to, kind, payload = "") => api(`/lives/${liveId}/signals`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, kind, payload })
});
export const LIVE_CATEGORY_LABELS = {
  conversa: "Conversa", musica: "Música", jogos: "Jogos", desporto: "Desporto", educacao: "Educação",
  negocios: "Negócios", fe: "Fé", arte: "Arte e criação", outro: "Outro"
};
// Qualidade de emissão do estúdio no browser. kbps = máximo enviado (quem vê recebe o mesmo).
export const LIVE_QUALITIES = {
  "480p30": { label: "480p · poupa dados", width: 854, height: 480, fps: 30, kbps: 1200 },
  "720p30": { label: "720p · recomendado", width: 1280, height: 720, fps: 30, kbps: 2500 },
  "720p60": { label: "720p 60 fps · jogos e desporto", width: 1280, height: 720, fps: 60, kbps: 4000 },
  "1080p30": { label: "1080p · Full HD", width: 1920, height: 1080, fps: 30, kbps: 4500 }
};
// Câmaras (inclui placas de captura e a «OBS Virtual Camera») e microfones (inclui placas de som).
export function useMediaDevices(active) {
  const [devices, setDevices] = useState({ video: [], audio: [] });
  useEffect(() => {
    if (!active || !navigator.mediaDevices?.enumerateDevices) return undefined;
    const load = () => navigator.mediaDevices.enumerateDevices().then(list => setDevices({
      video: list.filter(item => item.kind === "videoinput"),
      audio: list.filter(item => item.kind === "audioinput")
    })).catch(() => {});
    load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => navigator.mediaDevices.removeEventListener("devicechange", load);
  }, [active]);
  return devices;
}
export const audioConstraints = (deviceId, original) => ({
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  // Placas de captura e música: som tal como chega (sem cancelar eco nem "limpar" ruído).
  echoCancellation: !original, noiseSuppression: !original, autoGainControl: !original,
  ...(original ? { channelCount: 2, sampleRate: 48000 } : {})
});
// Abre a fonte escolhida. Ecrã: vídeo do ecrã + microfone, misturado com o som do ecrã se existir.
export async function openLiveSource({ kind, videoId, audioId, quality, originalAudio }) {
  const preset = LIVE_QUALITIES[quality] || LIVE_QUALITIES["720p30"];
  if (kind === "screen") {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Este browser não permite partilhar o ecrã. Usa o Chrome ou o Edge num computador.");
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: preset.fps }, height: { ideal: preset.height } }, audio: true });
    let mic = null;
    let micError = null;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(audioId, originalAudio) }); } catch (error) { micError = error.name; }
    const sources = [screen, mic].filter(stream => stream?.getAudioTracks().length);
    let audioTracks = sources.flatMap(stream => stream.getAudioTracks());
    if (sources.length > 1) {
      const context = new AudioContext();
      keepAudioRunning(context);
      const destination = context.createMediaStreamDestination();
      sources.forEach(stream => context.createMediaStreamSource(stream).connect(destination));
      audioTracks = destination.stream.getAudioTracks();
      audioTracks[0].addEventListener("ended", () => context.close());
    }
    const combined = new MediaStream([...screen.getVideoTracks(), ...audioTracks]);
    combined.parts = [screen, mic].filter(Boolean); // para desligar tudo no fim
    combined.micError = micError;
    // Para o estúdio mostrar microfone e som do ecrã em separado.
    combined.isScreen = true;
    combined.micStream = mic;
    combined.screenAudio = screen.getAudioTracks().length ? new MediaStream(screen.getAudioTracks()) : null;
    return combined;
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este browser não permite usar a câmara. Usa o Chrome, Edge ou Safari atualizados.");
  const video = { ...(videoId ? { deviceId: { exact: videoId } } : {}), width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.fps } };
  let micError = null;
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: audioConstraints(audioId, originalAudio) });
  } catch (error) {
    if (!MISSING_DEVICE_ERRORS.includes(error.name) && error.name !== "NotAllowedError") throw error;
    micError = error.name;
  }
  // Sabe se o bloqueio é só do microfone: se a câmara sozinha também for recusada, o erro sobe tal como está.
  const withoutMic = async constraints => {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.micError = micError === "NotAllowedError" ? "NotAllowedError" : "NotFoundError";
    return stream;
  };
  // Falta a câmara ou o microfone (ou o escolhido desligou-se): tenta só a imagem, com a câmara predefinida se for preciso.
  try {
    return await withoutMic({ video, audio: false });
  } catch (error) {
    if (!MISSING_DEVICE_ERRORS.includes(error.name)) throw error;
  }
  if (videoId) {
    try {
      return await withoutMic({ video: { ...video, deviceId: undefined }, audio: false });
    } catch (error) {
      if (!MISSING_DEVICE_ERRORS.includes(error.name)) throw error;
    }
  }
  const noCamera = new Error("Não encontrámos nenhuma câmara ligada a este computador. Liga uma webcam ou placa de captura, ou escolhe Ecrã ou OBS.");
  noCamera.name = "NoCameraError";
  throw noCamera;
}
// Erros do browser quando o dispositivo não existe ou já não está ligado.
export const MISSING_DEVICE_ERRORS = ["NotFoundError", "OverconstrainedError", "DevicesNotFoundError"];
// Traduz os erros do browser ao abrir câmara, microfone ou ecrã.
export function liveSourceError(error) {
  if (error.name === "NotAllowedError") return "O browser bloqueou o acesso. Carrega no cadeado ao lado do endereço, permite a câmara e o microfone, e tenta outra vez.";
  if (error.name === "NotReadableError") return "Esta câmara ou placa está a ser usada por outro programa. Fecha-o e tenta outra vez.";
  if (MISSING_DEVICE_ERRORS.includes(error.name)) return "Esse dispositivo não foi encontrado. Confirma que está ligado ou escolhe outro.";
  if (error.name === "AbortError") return "A partilha foi interrompida. Tenta outra vez.";
  return error.message || "Não foi possível abrir a fonte.";
}
// O Chrome só deixa o áudio da página correr logo após um clique. Se o AudioContext nascer
// "adormecido" (ex.: a pessoa demorou a escolher o ecrã), acorda-o já e no próximo clique ou tecla.
export function keepAudioRunning(context) {
  const resume = () => { if (context.state === "suspended") context.resume().catch(() => {}); };
  const events = ["pointerdown", "keydown"];
  const stop = () => events.forEach(name => document.removeEventListener(name, resume, true));
  resume();
  events.forEach(name => document.addEventListener(name, resume, true));
  context.addEventListener("statechange", () => {
    if (context.state === "running" || context.state === "closed") stop();
  });
  return stop;
}
export const stopStream = stream => {
  stream?.getTracks().forEach(track => track.stop());
  stream?.parts?.forEach(part => part.getTracks().forEach(track => track.stop()));
};
// Nível do microfone (0–1), para confirmar que o som está a entrar.
export function useAudioLevel(stream) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track || typeof AudioContext !== "function") { setLevel(0); return undefined; }
    const context = new AudioContext();
    const stopWaking = keepAudioRunning(context);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let frame = 0;
    // Escala em decibéis (-60 dB a 0 dB), como nas mesas de mistura: uma voz baixa também se vê.
    const read = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const sample of data) sum += sample * sample;
      const rms = Math.sqrt(sum / data.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -100;
      const next = Math.min(1, Math.max(0, (db + 60) / 60));
      setLevel(current => Math.max(next, current * 0.88));
      frame = window.requestAnimationFrame(read);
    };
    read();
    return () => { window.cancelAnimationFrame(frame); stopWaking(); context.close().catch(() => {}); };
  }, [stream]);
  return level;
}
// Barra do nível do som, com o nome do microfone e um aviso se não chegar som nenhum.
export function AudioMeter({ stream, original = false }) {
  const level = useAudioLevel(stream);
  const track = stream?.getAudioTracks()[0];
  const [heard, setHeard] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [muted, setMuted] = useState(Boolean(track?.muted));
  useEffect(() => { setHeard(false); setQuiet(false); }, [track]);
  // "muted" = o sistema não está a entregar som (privacidade do Windows, botão de silêncio, outro programa).
  useEffect(() => {
    if (!track) return undefined;
    const update = () => setMuted(track.muted);
    update();
    track.addEventListener("mute", update);
    track.addEventListener("unmute", update);
    return () => { track.removeEventListener("mute", update); track.removeEventListener("unmute", update); };
  }, [track]);
  useEffect(() => { if (level > 0.2) { setHeard(true); setQuiet(false); } }, [level]);
  useEffect(() => {
    if (!track || heard) return undefined;
    const timer = window.setTimeout(() => setQuiet(true), 5000);
    return () => window.clearTimeout(timer);
  }, [track, heard]);
  const name = track?.label && !/^MediaStreamAudioDestinationNode/.test(track.label) ? track.label : "";
  return <span className="live-meter-wrap">
    <span className="live-meter" role="meter" aria-label="Nível do som" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      <span style={{ transform: `scaleX(${Math.min(1, level * 1.6)})` }} />
    </span>
    <small className={`live-meter-note${quiet || muted ? " is-quiet" : ""}`}>
      {!track ? "Sem som"
        : muted ? `O Windows não está a deixar passar o som${name ? ` de «${name}»` : ""}. Em Definições do Windows → Privacidade → Microfone, permite o acesso às apps e ao Chrome, e confirma que o microfone não está em silêncio.`
          : quiet ? (original
            ? `Chega muito pouco som${name ? ` de «${name}»` : ""}. Desliga «Som original»: o volume do microfone passa a ser automático.`
            : `Não chega som${name ? ` de «${name}»` : ""}. Se não for o teu microfone, escolhe outro em «Som». Confirma também o volume em Definições do Windows → Sistema → Som → Entrada.`)
            : heard ? `A ouvir${name ? `: ${name}` : ""}` : `Fala para testar${name ? ` · ${name}` : ""}`}
    </small>
  </span>;
}
export const MIC_ERROR_TEXT = {
  NotAllowedError: "O Chrome bloqueou o microfone. Carrega no ícone ao lado do endereço, permite o microfone e escolhe o ecrã outra vez.",
  NotFoundError: "Não encontrámos nenhum microfone ligado. Liga-o e escolhe o ecrã outra vez.",
  OverconstrainedError: "O microfone escolhido em «Som» já não está ligado. Escolhe outro.",
  NotReadableError: "O microfone está a ser usado por outro programa (por exemplo Discord, Zoom ou Teams). Fecha-o e escolhe o ecrã outra vez."
};
// Níveis do som do estúdio. No ecrã há duas fontes (microfone e som do ecrã), cada uma com a sua barra,
// para se perceber logo qual delas não está a entrar.
export function LiveAudioMeters({ stream, original = false }) {
  if (!stream?.isScreen) return <div className="live-studio-level"><span>Nível do som</span><AudioMeter stream={stream} original={original} /></div>;
  return <div className="live-studio-level live-studio-levels">
    <div>
      <span><Icon name="mic" size={14} /> Microfone</span>
      {stream.micStream
        ? <AudioMeter stream={stream.micStream} original={original} />
        : <small className="live-meter-note is-quiet">{MIC_ERROR_TEXT[stream.micError] || "Não foi possível abrir o microfone. Escolhe o ecrã outra vez."}</small>}
    </div>
    <div>
      <span><Icon name="devices" size={14} /> Som do ecrã</span>
      {stream.screenAudio
        ? <AudioMeter stream={stream.screenAudio} />
        : <small className="live-meter-note">Sem som do ecrã. Para o incluir, escolhe um separador ou o ecrã inteiro e ativa «Partilhar áudio».</small>}
    </div>
  </div>;
}
// Enviar para o servidor de vídeo por WHIP (o mesmo protocolo que o OBS usa). Prefere H.264,
// que o HLS e todos os telemóveis tocam.
export async function publishWhip(url, stream, kbps, iceServers) {
  const pc = new RTCPeerConnection({ iceServers: iceServers || [] });
  for (const track of stream.getTracks()) {
    const transceiver = pc.addTransceiver(track, {
      direction: "sendonly", streams: [stream],
      ...(track.kind === "video" ? { sendEncodings: [{ maxBitrate: kbps * 1000 }] } : {})
    });
    if (track.kind === "video" && RTCRtpSender.getCapabilities) {
      const codecs = RTCRtpSender.getCapabilities("video")?.codecs || [];
      const h264 = codecs.filter(codec => codec.mimeType === "video/H264");
      if (h264.length && transceiver.setCodecPreferences) transceiver.setCodecPreferences([...h264, ...codecs.filter(codec => codec.mimeType !== "video/H264")]);
    }
  }
  await pc.setLocalDescription(await pc.createOffer());
  await waitForIce(pc, 2500);
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: pc.localDescription.sdp });
  if (!response.ok) { pc.close(); throw new Error(response.status === 401 ? "O servidor de vídeo recusou a emissão." : "Não foi possível ligar ao servidor de vídeo."); }
  await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
  const location = response.headers.get("Location");
  return { pc, resource: location ? new URL(location, url).href : "" };
}
// Ver por HLS (hls.js, carregado só quando é preciso; Safari usa o leitor nativo).
export function useHlsPlayback(videoRef, url, enabled, setState) {
  useEffect(() => {
    const video = videoRef.current;
    if (!url || !enabled || !video) return undefined;
    let hls = null;
    let retry = 0;
    let cancelled = false;
    const again = state => { setState(state); window.clearTimeout(retry); retry = window.setTimeout(start, 3000); };
    async function start() {
      if (cancelled) return;
      hls?.destroy();
      hls = null;
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: false, liveSyncDurationCount: 3, manifestLoadingMaxRetry: 1 });
        hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); setState("live"); });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          // 404: o servidor ainda não recebe o vídeo (OBS a ligar). Outro erro: rede; tenta de novo.
          again(data.response?.code === 404 ? "waiting" : "reconnecting");
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.onloadedmetadata = () => { video.play().catch(() => {}); setState("live"); };
        video.onerror = () => again("waiting");
      } else setState("unsupported");
    }
    setState("connecting");
    start();
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
      hls?.destroy();
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [url, enabled]);
}
export const maskKey = key => key ? `${key.slice(0, 10)}${"•".repeat(14)}` : "";
export function CopyField({ label, value, secret }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setShown(true); }
  };
  return <div className="copy-field">
    <span className="copy-field-label">{label}</span>
    <div className="copy-field-row">
      <code>{shown ? value : maskKey(value)}</code>
      {secret && <button type="button" className="btn secondary" onClick={() => setShown(value => !value)}>{shown ? "Esconder" : "Mostrar"}</button>}
      <button type="button" className="btn secondary" onClick={copy}><Icon name={copied ? "check" : "copy"} size={15} /> {copied ? "Copiado" : "Copiar"}</button>
    </div>
  </div>;
}
// Chave de transmissão para OBS, vMix, Streamlabs ou encoders e placas com saída RTMP.
export function StreamKeyPanel() {
  const [info, setInfo] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [protocol, setProtocol] = useState("rtmp");
  useEffect(() => { api("/lives/stream-key").then(setInfo).catch(loadError => setError(loadError.message)); }, []);
  const generate = async () => {
    if (info?.hasKey && !window.confirm("Gerar uma chave nova? A antiga deixa de funcionar e uma emissão em curso com ela é cortada.")) return;
    setBusy(true);
    setError("");
    try { const result = await api("/lives/stream-key", { method: "POST" }); setInfo(result); setFresh(result); }
    catch (keyError) { setError(keyError.message); }
    finally { setBusy(false); }
  };
  if (!info) return <div className="creator-loading">{error || "A carregar..."}</div>;
  const data = fresh || info;
  return <div className="stream-key">
    <div className="ad-toggle" role="group" aria-label="Protocolo">
      <button type="button" aria-pressed={protocol === "rtmp"} onClick={() => setProtocol("rtmp")}>RTMP</button>
      {data.whip && <button type="button" aria-pressed={protocol === "whip"} onClick={() => setProtocol("whip")}>WHIP</button>}
    </div>
    {protocol === "rtmp" ? <>
      <CopyField label="Servidor" value={data.rtmp?.server || ""} />
      {fresh ? <CopyField label="Chave de transmissão" value={fresh.rtmp.streamKey} secret />
        : <p className="muted stream-key-hint">{info.hasKey ? "A tua chave está guardada de forma segura e não pode ser mostrada outra vez. Se a perdeste, gera uma nova." : "Ainda não tens chave. Gera uma para ligar o OBS."}</p>}
    </> : <>
      <CopyField label="Servidor (WHIP)" value={data.whip.url} />
      {fresh ? <CopyField label="Bearer token" value={fresh.whip.token} secret />
        : <p className="muted stream-key-hint">Usa a mesma chave como «Bearer token». Gera uma nova se não a tens.</p>}
    </>}
    {fresh && <p className="info-draft" role="status"><Icon name="lock" size={15} /> Copia a chave agora: por segurança só é mostrada uma vez. Nunca a mostres no ecrã do direto.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <button type="button" className="btn secondary" onClick={generate} disabled={busy}><Icon name="reset" size={15} /> {busy ? "A gerar..." : info.hasKey ? "Gerar nova chave" : "Gerar chave"}</button>
    <details className="stream-key-help">
      <summary>Como configurar o OBS</summary>
      <ol>
        <li>No OBS: <strong>Definições → Transmissão</strong>, serviço <strong>Personalizado</strong> ({protocol === "rtmp" ? "RTMP" : "WHIP"}).</li>
        <li>Cola o servidor e a {protocol === "rtmp" ? "chave" : "bearer token"} acima.</li>
        <li><strong>Saída</strong>: H.264 (x264 ou NVENC), CBR, 2500–4500 kbps, intervalo de keyframes 2 s, áudio AAC 160 kbps.</li>
        <li><strong>Vídeo</strong>: 1280×720 a 30 fps (ou 1920×1080 com boa internet).</li>
        <li>Cria o direto aqui no Tchilar e depois carrega em <strong>Iniciar transmissão</strong> no OBS.</li>
      </ol>
      <p className="muted">A placa de captura (Elgato, AVerMedia...) entra no OBS como «Dispositivo de captura de vídeo». Também a podes escolher diretamente no estúdio do Tchilar, sem OBS.</p>
    </details>
  </div>;
}
// Sem servidor de vídeo (MEDIA_* no .env), o Tchilar não consegue receber o vídeo de programas externos.
export function ObsUnavailable() {
  return <div className="obs-unavailable">
    <span className="ad-kind-icon"><Icon name="info" size={18} /></span>
    <div>
      <strong>A transmissão por OBS ainda não está ligada neste servidor</strong>
      <p className="muted">Para usar OBS, vMix ou Streamlabs com chave de transmissão, a equipa do Tchilar tem de ligar o servidor de vídeo (MediaMTX). Enquanto isso, podes emitir pelo browser: escolhe «Câmara ou placa» — a placa de captura e a câmara virtual do OBS aparecem lá.</p>
    </div>
  </div>;
}
// A chave também se vê e gera fora de um direto (como nas definições de transmissão de outras plataformas).
export function StreamKeyDialog({ onClose }) {
  const [enabled, setEnabled] = useState(null);
  useEffect(() => { api("/lives/config").then(result => setEnabled(Boolean(result.obs))).catch(() => setEnabled(false)); }, []);
  useEffect(() => {
    const onKey = event => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal card stream-key-dialog" role="dialog" aria-modal="true" aria-labelledby="stream-key-title">
      <div className="share-dialog-head">
        <h2 id="stream-key-title">Chave de transmissão</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <p className="muted">Usa-a no OBS, vMix, Streamlabs ou numa placa/encoder com saída RTMP. Depois cria o direto no Tchilar com «OBS ou programa» e inicia a transmissão no programa.</p>
      {enabled === null ? <div className="creator-loading">A carregar...</div> : enabled ? <StreamKeyPanel /> : <ObsUnavailable />}
    </div>
  </div>, document.body);
}
export function StartLiveDialog({ onClose, pageId, pageName }) {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const [config, setConfig] = useState(null);
  const [mode, setMode] = useState("camera");
  const [stream, setStream] = useState(null);
  const [videoId, setVideoId] = useState("");
  const [audioId, setAudioId] = useState("");
  const [quality, setQuality] = useState("720p30");
  const [originalAudio, setOriginalAudio] = useState(false);
  const [details, setDetails] = useState({ title: "", description: "", category: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const streamRef = useRef(null);
  // Sem câmara: abre só o microfone, para a barra do som e a lista de microfones funcionarem na mesma.
  const [micPreview, setMicPreview] = useState(null);
  const micPreviewRef = useRef(null);
  const setMicOnly = next => {
    stopStream(micPreviewRef.current);
    micPreviewRef.current = next;
    setMicPreview(next);
  };
  const devices = useMediaDevices(Boolean(stream || micPreview));

  useEffect(() => { api("/lives/config").then(setConfig).catch(() => setConfig({ mode: "p2p", categories: Object.keys(LIVE_CATEGORY_LABELS) })); }, []);
  const replaceStream = next => {
    if (streamRef.current && streamRef.current !== pendingHostStream) stopStream(streamRef.current);
    streamRef.current = next;
    setStream(next);
    if (videoRef.current) videoRef.current.srcObject = next;
  };
  const open = async (kind = mode) => {
    setError("");
    setMicOnly(null);
    try {
      replaceStream(await openLiveSource({ kind, videoId, audioId, quality, originalAudio }));
    } catch (openError) {
      replaceStream(null);
      if (kind === "camera" && openError.name === "NoCameraError") {
        navigator.mediaDevices.getUserMedia({ audio: audioConstraints(audioId, originalAudio) })
          .then(setMicOnly)
          .catch(() => {});
      }
      // No ecrã, "NotAllowedError" quase sempre quer dizer que a pessoa fechou a janela de escolha.
      setError(kind === "screen" && openError.name === "NotAllowedError"
        ? "Não escolheste nenhum ecrã. Carrega em «Escolher ecrã ou janela» e escolhe um separador, janela ou ecrã inteiro."
        : liveSourceError(openError));
    }
  };
  // Câmara/placa: reabre ao mudar de dispositivo, qualidade ou tipo de som. Ecrã: só quando se carrega no botão.
  useEffect(() => { if (mode === "camera") open("camera"); }, [mode, videoId, audioId, quality, originalAudio]);
  useEffect(() => { setError(""); setMicOnly(null); if (mode !== "camera") replaceStream(null); }, [mode]);
  useEffect(() => () => { if (streamRef.current !== pendingHostStream) stopStream(streamRef.current); stopStream(micPreviewRef.current); }, []);

  const update = (key, value) => setDetails(current => ({ ...current, [key]: value }));
  const start = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/lives", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...details, source: mode === "obs" ? "obs" : "browser", ...(pageId ? { pageId } : {}) }) });
      if (mode !== "obs") { pendingHostStream = stream; pendingHostSettings = { quality, videoId, audioId, originalAudio, kind: mode }; }
      navigate(`/live/${result.id}`);
    } catch (startError) {
      setError(startError.message);
      setBusy(false);
    }
  };
  const canStart = details.title.trim() && (mode === "obs" ? Boolean(config?.obs) : stream);
  const sources = [
    ["camera", "video", "Câmara ou placa", "Webcam, placa de captura ou câmara virtual do OBS"],
    ["screen", "devices", "Ecrã", "Uma janela, separador ou o ecrã inteiro"],
    ["obs", "live", "OBS ou programa", "Chave de transmissão RTMP ou WHIP"]
  ];

  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card start-live-dialog live-studio" role="dialog" aria-modal="true" aria-labelledby="start-live-title" onSubmit={start}>
      <div className="share-dialog-head">
        <h2 id="start-live-title">{pageName ? `Direto · ${pageName}` : "Estúdio do direto"}</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      <div className="live-studio-grid">
        <div className="live-studio-media">
          <div className="ad-kind live-sources" role="radiogroup" aria-label="De onde vem o vídeo">
            {sources.map(([key, icon, label, hint]) => <label key={key} className={mode === key ? "is-selected" : ""}>
              <input type="radio" name="live-source" checked={mode === key} onChange={() => setMode(key)} />
              <span className="ad-kind-icon"><Icon name={icon} size={17} /></span>
              <span><strong>{label}</strong><small>{hint}</small></span>
            </label>)}
          </div>
          {mode === "obs" ? (config?.obs ? <StreamKeyPanel /> : <ObsUnavailable />) : <>
            <div className="start-live-preview">
              <video ref={videoRef} autoPlay muted playsInline />
              {!stream && (mode === "screen"
                ? <button type="button" className="btn" onClick={() => open("screen")}><Icon name="devices" size={16} /> Escolher ecrã ou janela</button>
                : error
                  ? <button type="button" className="btn secondary" onClick={() => open("camera")}><Icon name="reset" size={16} /> Tentar outra vez</button>
                  : <span>A abrir a câmara...</span>)}
              {stream && <LiveBadge small />}
              {stream && stream.getVideoTracks()[0] && <span className="live-studio-res">{(() => { const settings = stream.getVideoTracks()[0].getSettings(); return settings.height ? `${settings.width}×${settings.height}${settings.frameRate ? ` · ${Math.round(settings.frameRate)} fps` : ""}` : ""; })()}</span>}
            </div>
            <div className="live-studio-devices">
              {mode === "camera" && <label>Vídeo
                <Select value={videoId} onChange={event => setVideoId(event.target.value)}>
                  <option value="">Câmara predefinida</option>
                  {devices.video.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Câmara ${index + 1}`}</option>)}
                </Select>
              </label>}
              <label>Som
                <Select value={audioId} onChange={event => setAudioId(event.target.value)}>
                  <option value="">Microfone predefinido</option>
                  {devices.audio.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microfone ${index + 1}`}</option>)}
                </Select>
              </label>
              <label>Qualidade
                <Select value={quality} onChange={event => setQuality(event.target.value)}>
                  {Object.entries(LIVE_QUALITIES).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}
                </Select>
              </label>
              <LiveAudioMeters stream={stream || micPreview} original={originalAudio} />
            </div>
            {stream && !stream.getAudioTracks().length && <p className="live-studio-nosound" role="status">
              <Icon name="micOff" size={16} />
              {stream.micError === "NotAllowedError"
                ? "O browser bloqueou o microfone, por isso o direto vai sem som. Carrega no cadeado ao lado do endereço, permite o microfone e volta a escolher a fonte."
                : `Não encontrámos nenhum microfone: o direto vai sem som. Liga um microfone e escolhe-o em «Som»${mode === "screen" ? ", ou partilha o som do separador ao escolher o ecrã" : ""}.`}
            </p>}
            <label className="live-switch">
              <input type="checkbox" checked={originalAudio} onChange={event => setOriginalAudio(event.target.checked)} />
              <span><strong>Som original</strong><small>Para placas de captura, mesas de mistura e música: sem cancelamento de eco nem redução de ruído.</small></span>
            </label>
            {mode === "screen" && stream && <button type="button" className="btn secondary" onClick={() => open("screen")}>Escolher outro ecrã</button>}
          </>}
        </div>
        <div className="live-studio-details">
          <label>Título<input required maxLength={120} value={details.title} onChange={event => update("title", event.target.value)} placeholder="Ex.: Conversa sobre música angolana" /></label>
          <label><span className="ad-field-head">Descrição <CharCount value={details.description} max={500} /></span>
            <textarea rows={4} maxLength={500} value={details.description} onChange={event => update("description", event.target.value)} placeholder="Do que vais falar, convidados, horário..." /></label>
          <label>Categoria
            <Select value={details.category} onChange={event => update("category", event.target.value)}>
              <option value="">Sem categoria</option>
              {(config?.categories || Object.keys(LIVE_CATEGORY_LABELS)).map(key => <option key={key} value={key}>{LIVE_CATEGORY_LABELS[key] || key}</option>)}
            </Select>
          </label>
          <p className="muted create-page-note">{config?.mode === "cdn"
            ? "Quem te segue recebe uma notificação. O vídeo chega a todas as pessoas, mesmo a quem não tem conta."
            : "Quem te segue recebe uma notificação. Neste servidor o vídeo chega diretamente a até 8 pessoas; o chat e as estrelas funcionam para todos."}</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="btn live-start-button" type="submit" disabled={busy || !canStart}><Icon name="live" size={16} /> {busy ? "A começar..." : mode === "obs" ? "Criar direto" : "Entrar em direto"}</button>
          </div>
        </div>
      </div>
    </form>
  </div>, document.body);
}
export function LivePage() {
  const { liveId } = useParams();
  if (liveId) return <LiveRoom key={liveId} liveId={liveId} />;
  return <LiveList />;
}
export function LiveList() {
  const { user } = useContext(UserContext);
  const [lives, setLives] = useState(null);
  const [starting, setStarting] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [, tick] = useState(0);
  const load = () => api("/lives").then(result => setLives(result.lives)).catch(() => setLives([]));
  usePolling(load, 15000, true);
  useEffect(() => { load(); const timer = window.setInterval(() => tick(value => value + 1), 1000); return () => window.clearInterval(timer); }, []);
  const mine = lives?.find(live => user && live.username === user.username);
  const categories = [...new Set((lives || []).map(live => live.category).filter(Boolean))];
  const shown = (lives || []).filter(live => !category || live.category === category);
  return <div className="pages-view live-list">
    <header className="pages-head">
      <div><h1>Diretos</h1><p>Vê quem está a emitir agora, conversa no chat e apoia com estrelas.</p></div>
      <div className="live-head-actions">
        {user && <button className="btn secondary" type="button" onClick={() => setKeyOpen(true)}><Icon name="lock" size={16} /> Chave para OBS</button>}
        {user ? (mine ? <Link className="btn live-start-button" to={`/live/${mine.id}`}><Icon name="live" size={16} /> Voltar ao teu direto</Link>
          : <button className="btn live-start-button" type="button" onClick={() => setStarting(true)}><Icon name="live" size={16} /> Começar um direto</button>)
          : <Link className="btn" to="/login">Entrar para emitir</Link>}
      </div>
    </header>
    {keyOpen && <StreamKeyDialog onClose={() => setKeyOpen(false)} />}
    {categories.length > 0 && <div className="ad-filters live-categories" role="group" aria-label="Categorias">
      <button type="button" aria-pressed={!category} onClick={() => setCategory("")}>Todos <span>{lives.length}</span></button>
      {categories.map(key => <button key={key} type="button" aria-pressed={category === key} onClick={() => setCategory(key)}>
        {LIVE_CATEGORY_LABELS[key] || key} <span>{lives.filter(live => live.category === key).length}</span></button>)}
    </div>}
    {!lives && <div className="empty card">A procurar diretos...</div>}
    {lives && !lives.length && <div className="empty card pages-empty live-empty">
      <span className="group-lock-icon live-empty-icon"><Icon name="live" size={26} /></span>
      <p>Ninguém está em direto neste momento. Sê a primeira pessoa: mostra o que estás a fazer, responde a perguntas, recebe estrelas.</p>
      {user && <button className="btn live-start-button" type="button" onClick={() => setStarting(true)}><Icon name="live" size={16} /> Começar um direto</button>}
    </div>}
    {shown.length > 0 && <div className="pages-grid">{shown.map(live => <Link key={live.id} to={`/live/${live.id}`} className="live-card card">
      <span className={`live-card-cover tone-page-${pageTone(live.username)}`}>
        <span className="live-card-avatar"><Avatar user={live} size="large" /></span>
        <LiveBadge small />
        <span className="live-card-viewers"><Icon name="eye" size={13} /> {formatCount(live.viewers)}</span>
      </span>
      <span className="live-card-body">
        <strong>{live.title}</strong>
        <small>{live.display_name}<VerifiedBadge show={live.is_verified} tier={live.verification_tier} /> · há {liveDuration(live.started_at)}{live.page_name ? ` · Página ${live.page_name}` : ""}</small>
        {live.category && <small className="live-card-category">{LIVE_CATEGORY_LABELS[live.category] || live.category}</small>}
      </span>
    </Link>)}</div>}
    {starting && <StartLiveDialog onClose={() => setStarting(false)} />}
  </div>;
}
export const LIVE_REACTIONS = [["heart", "Coração"], ["like", "Gosto"], ["spark", "Faísca"]];
// Moderadores: escolhidos por quem emite e válidos em todos os seus diretos.
export function LiveModerators() {
  const [list, setList] = useState(null);
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api("/lives/moderators").then(result => setList(result.moderators)).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, []);
  const add = async event => {
    event.preventDefault();
    if (!username.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api("/lives/moderators", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
      setUsername("");
      await load();
    } catch (addError) {
      setError(addError.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async person => {
    try {
      await api(`/lives/moderators/${person.id}`, { method: "DELETE" });
      setList(current => current.filter(item => item.id !== person.id));
    } catch (removeError) {
      setError(removeError.message);
    }
  };
  return <div className="live-mods">
    <h3>Moderadores</h3>
    <p className="muted">Podem apagar mensagens, fixar e silenciar pessoas no chat. Valem para todos os teus diretos.</p>
    <form className="live-mods-add" onSubmit={add}>
      <input value={username} onChange={event => setUsername(event.target.value)} placeholder="@nome_de_utilizador" aria-label="Nome de utilizador do moderador" />
      <button className="btn secondary" type="submit" disabled={busy || !username.trim()}>Adicionar</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {list?.length > 0 && <ul className="live-mods-list">{list.map(person => <li key={person.id}>
      <Avatar user={person} size="tiny" />
      <span><strong>{person.display_name}</strong><small>@{person.username}</small></span>
      <button type="button" className="btn secondary icon-only" aria-label={`Retirar ${person.display_name} dos moderadores`} title="Retirar" onClick={() => remove(person)}><Icon name="close" size={15} /></button>
    </li>)}</ul>}
  </div>;
}
export function LiveRoom({ liveId }) {
  const { user } = useContext(UserContext);
  const [live, setLive] = useState(null);
  const [supporters, setSupporters] = useState([]);
  const [error, setError] = useState("");
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [config, setConfig] = useState(null);
  const [videoState, setVideoState] = useState("connecting");
  const [muted, setMuted] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [panel, setPanel] = useState("chat");
  const [balance, setBalance] = useState(null);
  const [giftMessage, setGiftMessage] = useState("");
  const [feedPoll, setFeedPoll] = useState(2500);
  const [pinned, setPinned] = useState(null);
  const [roles, setRoles] = useState({ host: "", moderators: [] });
  const [floats, setFloats] = useState([]);
  const [giftShow, setGiftShow] = useState(null);      // presente a aparecer em grande por cima do vídeo
  const [giftsOpen, setGiftsOpen] = useState(false);
  const lastGiftSeen = useRef(null);                   // null = ainda não carregou o feed (não anima o histórico)
  const giftQueue = useRef([]);
  const reactionTotals = useRef(null);
  const ownReactions = useRef({ heart: 0, like: 0, spark: 0 });
  const [beatMs, setBeatMs] = useState(30000);
  const [hostStream, setHostStream] = useState(null);
  const [studio, setStudio] = useState({ signal: null, stats: null });
  const [settings, setSettings] = useState(() => pendingHostSettings || { quality: "720p30", videoId: "", audioId: "", originalAudio: false, kind: "camera" });
  const [blocked, setBlocked] = useState(() => new Set());
  const [, tick] = useState(0);
  const videoRef = useRef(null);
  const chatRef = useRef(null);
  const streamRef = useRef(null);
  const whip = useRef(null);             // modo cdn: ligação WHIP de quem emite
  const peers = useRef(new Map());     // modo p2p: uma ligação por espectador
  const viewerPc = useRef(null);       // modo p2p: a ligação do espectador a quem emite
  const viewerSession = useRef("");
  const lastSignal = useRef(0);
  const isHost = Boolean(live?.is_host);
  const ended = live?.status === "ended";
  const cdn = config?.mode === "cdn";
  const fromObs = live?.source === "obs";

  const loadLive = async () => {
    try {
      const result = await api(`/lives/${liveId}`);
      setLive(result.live);
      setSupporters(result.supporters);
      if (result.live.signal) setStudio({ signal: result.live.signal, stats: result.live.stats });
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => {
    loadLive();
    api("/lives/config").then(setConfig).catch(() => setConfig({ mode: "p2p", iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], giftAmounts: [1, 5, 10, 50, 100], gifts: [] }));
    const timer = window.setInterval(() => tick(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [liveId]);
  useEffect(() => { if (user) api("/blocks").then(result => setBlocked(new Set(result.blocked.map(person => person.username)))).catch(() => {}); }, [user?.id]);

  // ----- Quem emite pelo browser: abre a fonte e envia (WHIP em modo cdn) -----
  const startWhip = async stream => {
    whip.current?.pc.close();
    const { whip: url } = await api(`/lives/${liveId}/publish`, { method: "POST" });
    const preset = LIVE_QUALITIES[settings.quality] || LIVE_QUALITIES["720p30"];
    const connection = await publishWhip(url, stream, preset.kbps, config.iceServers);
    whip.current = connection;
    connection.pc.addEventListener("connectionstatechange", () => {
      if (connection.pc.connectionState === "failed" && whip.current === connection) {
        setVideoState("reconnecting");
        window.setTimeout(() => { if (whip.current === connection && streamRef.current) startWhip(streamRef.current).then(() => setVideoState("live")).catch(() => setVideoState("failed")); }, 2000);
      }
    });
  };

  useEffect(() => {
    if (!isHost || ended || fromObs || !config) return undefined;
    let cancelled = false;
    (async () => {
      let stream = pendingHostStream;
      pendingHostStream = null;
      pendingHostSettings = null;
      if (!stream) {
        try { stream = await openLiveSource({ ...settings, kind: settings.kind === "screen" ? "camera" : settings.kind }); }
        catch { setVideoState("no-camera"); return; }
      }
      if (cancelled) { stopStream(stream); return; }
      streamRef.current = stream;
      setHostStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
      if (cdn) {
        setVideoState("publishing");
        try { await startWhip(stream); if (!cancelled) setVideoState("live"); }
        catch (publishError) { if (!cancelled) { setVideoState("failed"); setGiftMessage(publishError.message); } }
      } else setVideoState("live");
    })();
    return () => {
      cancelled = true;
      if (whip.current) {
        if (whip.current.resource) fetch(whip.current.resource, { method: "DELETE" }).catch(() => {});
        whip.current.pc.close();
        whip.current = null;
      }
      peers.current.forEach(pc => pc.close());
      peers.current.clear();
      stopStream(streamRef.current);
    };
  }, [isHost, ended, fromObs, Boolean(config)]);

  // Trocar de câmara/placa/microfone sem parar o direto: substitui as faixas em todas as ligações.
  const switchSource = async next => {
    const merged = { ...settings, ...next };
    setSettings(merged);
    try {
      const stream = await openLiveSource(merged);
      const senders = [...(whip.current ? whip.current.pc.getSenders() : []), ...[...peers.current.values()].flatMap(pc => pc.getSenders())];
      for (const track of stream.getTracks()) {
        for (const sender of senders.filter(item => item.track?.kind === track.kind)) await sender.replaceTrack(track);
      }
      const previous = streamRef.current;
      streamRef.current = stream;
      setHostStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
      setMicOn(true);
      setCamOn(true);
      stopStream(previous);
    } catch (switchError) {
      setGiftMessage(liveSourceError(switchError));
    }
  };
  const devices = useMediaDevices(isHost && !fromObs && Boolean(hostStream));

  // ----- Quem vê em modo cdn (e quem emite pelo OBS, para confirmar o que sai): HLS -----
  // Só depois de a configuração chegar é que o <video> existe (antes mostra «A abrir o direto...»).
  const watchHls = Boolean(live?.playback?.hls && config) && !ended && (!isHost || fromObs);
  useHlsPlayback(videoRef, live?.playback?.hls, watchHls, setVideoState);

  // ----- Modo p2p (sem servidor de vídeo) -----
  const answerOffer = async signal => {
    const viewerId = signal.from_user;
    peers.current.get(viewerId)?.close();
    if (peers.current.size >= (config.maxVideoViewers || 8) || !streamRef.current) {
      await sendSignal(liveId, viewerId, "bye", JSON.stringify({ session: JSON.parse(signal.payload).session, reason: "full" }));
      return;
    }
    const pc = new RTCPeerConnection({ iceServers: config.iceServers, iceTransportPolicy: config.iceTransportPolicy || "all" });
    peers.current.set(viewerId, pc);
    streamRef.current.getTracks().forEach(track => pc.addTrack(track, streamRef.current));
    pc.addEventListener("connectionstatechange", () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) { pc.close(); peers.current.delete(viewerId); }
    });
    const offer = JSON.parse(signal.payload);
    await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIce(pc);
    await sendSignal(liveId, viewerId, "answer", JSON.stringify({ session: offer.session, sdp: pc.localDescription.sdp }));
  };

  const connectViewer = async () => {
    if (!live || isHost || ended || !user || cdn || !config || typeof RTCPeerConnection !== "function") return;
    viewerPc.current?.close();
    setVideoState("connecting");
    const pc = new RTCPeerConnection({ iceServers: config.iceServers, iceTransportPolicy: config.iceTransportPolicy || "all" });
    viewerPc.current = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.addEventListener("track", event => { if (videoRef.current) videoRef.current.srcObject = event.streams[0]; setVideoState("live"); });
    pc.addEventListener("connectionstatechange", () => { if (pc.connectionState === "failed") setVideoState("failed"); });
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc);
    viewerSession.current = Math.random().toString(36).slice(2);
    await sendSignal(liveId, live.host_id, "offer", JSON.stringify({ session: viewerSession.current, sdp: pc.localDescription.sdp }));
  };

  useEffect(() => {
    if (config && !cdn && live && !isHost && !ended && user) connectViewer().catch(() => setVideoState("failed"));
    return () => {
      if (viewerPc.current && live && !isHost) { sendSignal(liveId, live.host_id, "bye").catch(() => {}); viewerPc.current.close(); viewerPc.current = null; }
    };
  }, [live?.id, isHost, ended, user?.id, cdn, Boolean(config)]);

  usePolling(async () => {
    if (!user || !live || ended) return;
    const result = await api(`/lives/${liveId}/signals?after=${lastSignal.current}`);
    for (const signal of result.signals) {
      lastSignal.current = Math.max(lastSignal.current, signal.id);
      if (isHost && signal.kind === "offer") await answerOffer(signal).catch(offerError => console.warn("Live offer:", offerError.message));
      if (isHost && signal.kind === "bye") { peers.current.get(signal.from_user)?.close(); peers.current.delete(signal.from_user); }
      if (!isHost && (signal.kind === "answer" || signal.kind === "bye")) {
        let data = {};
        try { data = JSON.parse(signal.payload || "{}"); } catch { data = {}; }
        if (data.session !== viewerSession.current) continue;
        if (signal.kind === "answer" && viewerPc.current?.signalingState === "have-local-offer") {
          await viewerPc.current.setRemoteDescription({ type: "answer", sdp: data.sdp }).catch(() => setVideoState("failed"));
        }
        if (signal.kind === "bye") setVideoState(data.reason === "full" ? "full" : "connecting");
      }
    }
  }, 1500, Boolean(user && live && !ended && config && !cdn));

  // Sinal de vida: quem emite a cada 8 s (mantém o direto e recebe o estado do vídeo); quem vê a cada 30–60 s (o servidor diz).
  usePolling(async () => {
    if (!user || !live || ended) return;
    const beat = await api(`/lives/${liveId}/heartbeat`, { method: "POST" });
    setLive(current => current && { ...current, viewers: beat.viewers, status: beat.status });
    if (isHost) setStudio({ signal: beat.signal, stats: beat.stats });
    else if (beat.next) setBeatMs(beat.next);
  }, isHost ? 8000 : beatMs, Boolean(user && live && !ended));
  useEffect(() => {
    if (!user || !live || isHost || ended) return undefined;
    api(`/lives/${liveId}/heartbeat`, { method: "POST" }).catch(() => {});
    // Ao sair da sala deixa logo de contar (sem esperar que o sinal de vida expire).
    return () => { api(`/lives/${liveId}/leave`, { method: "POST" }).catch(() => {}); };
  }, [live?.id, user?.id, isHost, ended]);

  // Chat, estrelas e audiência: um feed igual para todos (cacheável), lido com mais calma em diretos grandes.
  // Reações a subir no vídeo (no máximo 24 ao mesmo tempo, para não pesar em telemóveis).
  const spawnFloats = (kind, count) => {
    const fresh = Array.from({ length: count }, () => ({
      id: Math.random().toString(36).slice(2), kind, x: Math.round(Math.random() * 40), drift: Math.round(Math.random() * 50 - 25)
    }));
    setFloats(current => [...current, ...fresh].slice(-24));
    window.setTimeout(() => setFloats(current => current.filter(item => !fresh.includes(item))), 2600);
  };

  // Presentes novos: aparecem um de cada vez, em grande, com o som do presente.
  const showNextGift = () => {
    const next = giftQueue.current.shift();
    if (!next) { setGiftShow(null); return; }
    setGiftShow(next);
    playGiftSound(next.sound);
    window.setTimeout(showNextGift, next.sound >= 6 ? 4200 : next.sound ? 3400 : 2600);
  };
  const queueGifts = list => {
    const catalog = Object.fromEntries((config?.gifts || []).map(item => [item.key, item]));
    const fresh = list.filter(comment => comment.gift && catalog[comment.gift]);
    if (!fresh.length) return;
    const wasIdle = !giftQueue.current.length && !giftShow;
    giftQueue.current.push(...fresh.slice(-6).map(comment => ({ ...catalog[comment.gift], id: comment.id, from: comment.display_name || "Alguém" })));
    if (wasIdle) showNextGift();
  };
  const applyFeed = feed => {
    const newestGift = feed.comments.reduce((max, comment) => comment.gift ? Math.max(max, comment.id) : max, 0);
    if (lastGiftSeen.current === null) lastGiftSeen.current = newestGift;
    else if (newestGift > lastGiftSeen.current) {
      queueGifts(feed.comments.filter(comment => comment.gift && comment.id > lastGiftSeen.current));
      lastGiftSeen.current = newestGift;
    }
    setComments(current => {
      // O feed traz as últimas mensagens visíveis: as apagadas pela moderação desaparecem também aqui.
      const ids = new Set(feed.comments.map(comment => comment.id));
      const oldest = feed.comments[0]?.id ?? Infinity;
      const kept = current.filter(comment => comment.id < oldest || ids.has(comment.id));
      const last = kept.at(-1)?.id || 0;
      const fresh = feed.comments.filter(comment => comment.id > last);
      return fresh.length || kept.length !== current.length ? [...kept, ...fresh].slice(-150) : current;
    });
    setPinned(feed.pinned || null);
    setRoles({ host: feed.host || "", moderators: feed.moderators || [] });
    if (feed.reactions) {
      const previous = reactionTotals.current;
      reactionTotals.current = feed.reactions;
      if (previous) for (const [kind, total] of Object.entries(feed.reactions)) {
        const delta = Math.max(0, total - (previous[kind] || 0));
        const mine = Math.min(delta, ownReactions.current[kind] || 0);
        ownReactions.current[kind] = (ownReactions.current[kind] || 0) - mine;
        if (delta - mine > 0) spawnFloats(kind, Math.min(delta - mine, 8));
      }
    }
    setSupporters(feed.supporters);
    setFeedPoll(feed.poll || 2500);
    setLive(current => current && { ...current, stars: feed.stars, viewers: feed.viewers, status: feed.status === "ended" ? "ended" : current.status });
  };
  const loadFeed = () => api(`/lives/${liveId}/feed`).then(applyFeed);
  useEffect(() => { if (live?.id) loadFeed().catch(() => {}); }, [live?.id]);
  usePolling(loadFeed, feedPoll, Boolean(live && !ended));

  const visibleComments = blocked.size ? comments.filter(comment => !blocked.has(comment.username)) : comments;
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }); }, [visibleComments.length]);

  const react = async kind => {
    spawnFloats(kind, 1);
    ownReactions.current[kind] = (ownReactions.current[kind] || 0) + 1;
    try {
      const result = await api(`/lives/${liveId}/react`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
      if (!result.counted) ownReactions.current[kind] -= 1;
    } catch {
      ownReactions.current[kind] -= 1;
    }
  };

  const myRole = isHost ? "host" : user && roles.moderators.includes(user.username) ? "moderator" : null;
  const roleOf = username => username && username === roles.host ? "host" : roles.moderators.includes(username) ? "moderator" : null;
  const moderate = async (action, comment) => {
    setGiftMessage("");
    const json = body => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try {
      if (action === "delete") {
        await api(`/lives/${liveId}/comments/${comment.id}`, { method: "DELETE" });
        setComments(current => current.filter(item => item.id !== comment.id));
      }
      if (action === "pin") await api(`/lives/${liveId}/pin`, json({ commentId: comment.id }));
      if (action === "unpin") await api(`/lives/${liveId}/pin`, json({ commentId: null }));
      if (action === "mute") {
        await api(`/lives/${liveId}/mute`, json({ username: comment.username, minutes: 10 }));
        setGiftMessage(`${comment.display_name} não pode escrever no chat durante 10 minutos.`);
      }
      loadFeed().catch(() => {});
    } catch (moderateError) {
      setGiftMessage(moderateError.message);
    }
  };

  const sendComment = async event => {
    event.preventDefault();
    if (!text.trim()) return;
    const body = text;
    setText("");
    try {
      await api(`/lives/${liveId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
      loadFeed().catch(() => {});
    } catch (sendError) {
      setText(body);
      setGiftMessage(sendError.message);
    }
  };

  const gift = async key => {
    setGiftMessage("");
    try {
      const result = await api(`/lives/${liveId}/stars`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gift: key }) });
      setGiftsOpen(false);
      setBalance(result.balance);
      loadFeed().catch(() => {});
    } catch (giftError) {
      setGiftMessage(giftError.message);
    }
  };

  const toggleTrack = kind => {
    const track = streamRef.current?.getTracks().find(item => item.kind === kind);
    if (!track) return;
    track.enabled = !track.enabled;
    kind === "audio" ? setMicOn(track.enabled) : setCamOn(track.enabled);
  };

  const endLive = async () => {
    if (!window.confirm("Terminar o direto para toda a gente?")) return;
    try {
      // Fecha primeiro a emissão WHIP (depois de terminar, o servidor já a teria cortado).
      if (whip.current) {
        const { pc, resource } = whip.current;
        whip.current = null;
        if (resource) await fetch(resource, { method: "DELETE" }).catch(() => {});
        pc.close();
      }
      await api(`/lives/${liveId}/end`, { method: "POST" });
      stopStream(streamRef.current);
      await loadLive();
    } catch (endError) {
      setError(endError.message);
    }
  };

  useEffect(() => { if (user && !isHost) api("/stars").then(result => setBalance(result.balance)).catch(() => {}); }, [user?.id, isHost]);

  if (error && !live) return <div className="page narrow"><div className="empty card">{error} <Link to="/live">Ver diretos</Link></div></div>;
  if (!live || !config) return <div className="page narrow"><div className="empty card">A abrir o direto...</div></div>;

  const needsLogin = !user && !cdn;
  const overlayText = {
    connecting: "A ligar ao direto...",
    publishing: "A enviar o vídeo para o servidor...",
    reconnecting: "A ligação falhou. A tentar outra vez...",
    waiting: isHost ? "À espera do sinal do OBS. Carrega em «Iniciar transmissão» no programa." : "À espera do vídeo de quem emite...",
    failed: isHost ? "Não foi possível enviar o vídeo. Verifica a internet e recarrega a página." : "Não foi possível receber o vídeo nesta rede. O chat e as estrelas continuam a funcionar.",
    full: "O vídeo chegou ao limite de espectadores deste servidor. Continua no chat.",
    unsupported: "Este browser não consegue tocar o direto. Atualiza-o ou usa o Chrome.",
    "no-camera": "Não foi possível abrir a câmara. Autoriza o acesso e recarrega a página."
  }[videoState];
  const signal = studio.signal;
  const stats = studio.stats;

  return <div className="live-room">
    <Link className="page-back" to="/live"><Icon name="previous" size={18} /> Todos os diretos</Link>
    <div className="live-layout">
      <section className="live-stage">
        <div className={`live-video${ended ? " is-ended" : ""}`}>
          <video ref={videoRef} autoPlay playsInline muted={(isHost && !fromObs) || muted} />
          {/* Presente a aparecer em grande, ao centro do vídeo (por cima de tudo). */}
          {giftShow && <div key={giftShow.id} className={`live-gift-show level-${giftShow.sound}`} role="status">
            <GiftIcon gift={giftShow.key} size={giftShow.sound >= 5 ? 150 : 120} />
            <strong>{giftShow.from}</strong>
            <span>ofereceu {giftShow.name} · {formatCount(giftShow.kz)} Kz</span>
          </div>}
          {ended ? <div className="live-overlay is-ended">
            <Avatar user={live} size="large" />
            <strong>O direto terminou</strong>
            <span>{formatCount(live.peak_viewers)} {live.peak_viewers === 1 ? "pessoa viu" : "pessoas viram"} ao mesmo tempo · {formatCount(live.unique_viewers)} no total · {formatCount(live.stars)} estrelas</span>
            <Link className="btn" to={`/u/${live.username}`}>Ver perfil de {live.display_name}</Link>
          </div> : needsLogin ? <div className="live-overlay"><strong>Entra na tua conta para ver o direto.</strong><Link className="btn" to="/login">Entrar</Link></div>
            : overlayText && videoState !== "live" && <div className="live-overlay">{["connecting", "publishing", "reconnecting", "waiting"].includes(videoState) && <span className="payment-spinner" aria-hidden="true" />}<span>{overlayText}</span>
              {videoState === "failed" && !isHost && !cdn && <button className="btn secondary" type="button" onClick={() => connectViewer()}>Tentar outra vez</button>}</div>}
          {!ended && <div className="live-topbar">
            <LiveBadge />
            <span className="live-chip"><Icon name="eye" size={14} /> {formatCount(live.viewers)}</span>
            <span className="live-chip">{liveDuration(live.started_at)}</span>
            <span className="live-chip live-chip-stars"><Icon name="star" size={14} /> {formatCount(live.stars)}</span>
          </div>}
          <div className="live-floats" aria-hidden="true">
            {floats.map(item => <span key={item.id} className={`live-float is-${item.kind}`} style={{ "--x": `${item.x}px`, "--drift": `${item.drift}px` }}><Icon name={item.kind} size={26} /></span>)}
          </div>
          {!ended && user && !isHost && <div className="live-reactions" role="group" aria-label="Reagir">
            {LIVE_REACTIONS.map(([kind, label]) => <button key={kind} type="button" className={`is-${kind}`} aria-label={label} title={label} onClick={() => react(kind)}><Icon name={kind} size={22} /></button>)}
          </div>}
          {!ended && (!isHost || fromObs) && videoState === "live" && <button className="live-sound" type="button" onClick={() => setMuted(value => !value)} aria-pressed={!muted}>
            <Icon name={muted ? "volumeOff" : "volumeOn"} size={18} /> {muted ? "Ativar som" : "Som ligado"}</button>}
          {isHost && !ended && <div className="live-controls">
            {!fromObs && <>
              <button type="button" className={micOn ? "" : "is-off"} onClick={() => toggleTrack("audio")} aria-pressed={!micOn} aria-label={micOn ? "Desligar microfone" : "Ligar microfone"}><Icon name={micOn ? "mic" : "micOff"} size={20} /></button>
              <button type="button" className={camOn ? "" : "is-off"} onClick={() => toggleTrack("video")} aria-pressed={!camOn} aria-label={camOn ? "Desligar câmara" : "Ligar câmara"}><Icon name={camOn ? "video" : "videoOff"} size={20} /></button>
            </>}
            <button type="button" className="live-end" onClick={endLive}><Icon name="stop" size={18} /> Terminar</button>
          </div>}
        </div>
        <div className="live-host">
          <Link to={`/u/${live.username}`} aria-label={`Perfil de ${live.display_name}`}><Avatar user={live} size="large" /></Link>
          <div>
            <h1>{live.title}</h1>
            <p><Link className="post-author" to={`/u/${live.username}`}>{live.display_name}</Link><VerifiedBadge show={live.is_verified} tier={live.verification_tier} />
              {live.page_id && live.page_name && <Link className="live-category" to={`/pages/${live.page_id}`}>Página {live.page_name}</Link>}
              {live.category && <span className="live-category">{LIVE_CATEGORY_LABELS[live.category] || live.category}</span>}</p>
            {live.description && <p className="live-description">{live.description}</p>}
          </div>
        </div>
      </section>

      <aside className="live-side card">
        <div className="pages-tabs live-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={panel === "chat"} onClick={() => setPanel("chat")}>Chat<span>{visibleComments.length}</span></button>
          <button type="button" role="tab" aria-selected={panel === "top"} onClick={() => setPanel("top")}>Apoiantes<span>{supporters.length}</span></button>
          {isHost && !ended && <button type="button" role="tab" aria-selected={panel === "studio"} onClick={() => setPanel("studio")}>Estúdio</button>}
        </div>
        {panel === "studio" && isHost ? <div className="live-studio-panel">
          <dl className="live-studio-stats">
            <div><dt>A ver agora</dt><dd>{formatCount(live.viewers)}</dd></div>
            <div><dt>Pico</dt><dd>{formatCount(stats?.peak ?? live.viewers)}</dd></div>
            <div><dt>Pessoas diferentes</dt><dd>{formatCount(stats?.unique ?? 0)}</dd></div>
            <div><dt>Estrelas</dt><dd>{formatCount(live.stars)}</dd></div>
          </dl>
          {cdn && <div className={`live-signal${signal?.ready ? " is-on" : ""}`}>
            <span className="live-dot" aria-hidden="true" />
            <span><strong>{signal?.ready ? "Sinal a chegar ao servidor" : "Sem sinal no servidor"}</strong>
              <small>{signal?.ready ? `${signal.width && signal.height ? `${signal.width}×${signal.height} · ` : ""}${formatCount(signal.kbps)} kbps` : fromObs ? "Inicia a transmissão no OBS." : "A ligar..."}</small></span>
          </div>}
          {fromObs ? <>
            <h3>Ligação do OBS</h3>
            <StreamKeyPanel />
          </> : <div className="live-studio-devices">
            <label>Vídeo
              <Select value={settings.videoId} onChange={event => switchSource({ videoId: event.target.value, kind: "camera" })}>
                <option value="">Câmara predefinida</option>
                {devices.video.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Câmara ${index + 1}`}</option>)}
              </Select>
            </label>
            <label>Som
              <Select value={settings.audioId} onChange={event => switchSource({ audioId: event.target.value })}>
                <option value="">Microfone predefinido</option>
                {devices.audio.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microfone ${index + 1}`}</option>)}
              </Select>
            </label>
            <LiveAudioMeters stream={hostStream} original={settings.originalAudio} />
            <label className="live-switch">
              <input type="checkbox" checked={settings.originalAudio} onChange={event => switchSource({ originalAudio: event.target.checked })} />
              <span><strong>Som original</strong><small>Sem cancelamento de eco nem redução de ruído.</small></span>
            </label>
            <button type="button" className="btn secondary" onClick={() => switchSource({ kind: "screen" })}><Icon name="devices" size={15} /> Partilhar ecrã</button>
            {settings.kind === "screen" && <button type="button" className="btn secondary" onClick={() => switchSource({ kind: "camera" })}><Icon name="video" size={15} /> Voltar à câmara</button>}
          </div>}
          <LiveModerators />
          {!cdn && <p className="muted">Neste servidor o vídeo vai diretamente do teu browser para até {config.maxVideoViewers || 8} pessoas. Com o servidor de vídeo configurado, não há limite.</p>}
        </div> : panel === "chat" ? <>
          {pinned && <div className="live-pinned">
            <Icon name="pin" size={15} />
            <span><strong>{pinned.display_name || "Alguém"}</strong> {pinned.body}</span>
            {myRole && !ended && <button type="button" className="live-chat-action" aria-label="Desafixar mensagem" title="Desafixar" onClick={() => moderate("unpin")}><Icon name="unpin" size={15} /></button>}
          </div>}
          <ol className="live-chat" ref={chatRef} aria-live="polite">
            {!visibleComments.length && <li className="live-chat-empty">Ainda não há mensagens. Diz olá!</li>}
            {visibleComments.map(comment => {
              const role = roleOf(comment.username);
              const canAct = myRole && !ended && !comment.stars && comment.username && (myRole === "host" || role !== "host");
              return <li key={comment.id} className={comment.stars ? "is-gift" : ""}>
                <Avatar user={comment} size="tiny" />
                <span><strong>{comment.display_name || "Alguém"}</strong>
                  {role && <span className={`live-role is-${role}`}>{role === "host" ? "Anfitrião" : "Moderador"}</span>}{" "}
                  {comment.stars ? <span className="live-gift-text">{comment.gift ? <GiftIcon gift={comment.gift} size={18} /> : <Icon name="star" size={13} />} {comment.body}</span> : comment.body}</span>
                {canAct && <span className="live-chat-actions">
                  <button type="button" className="live-chat-action" aria-label={`Fixar mensagem de ${comment.display_name}`} title="Fixar" onClick={() => moderate("pin", comment)}><Icon name="pin" size={14} /></button>
                  <button type="button" className="live-chat-action" aria-label={`Apagar mensagem de ${comment.display_name}`} title="Apagar" onClick={() => moderate("delete", comment)}><Icon name="trash" size={14} /></button>
                  {!role && <button type="button" className="live-chat-action" aria-label={`Silenciar ${comment.display_name} durante 10 minutos`} title="Silenciar 10 min" onClick={() => moderate("mute", comment)}><Icon name="silence" size={14} /></button>}
                </span>}
              </li>;
            })}
          </ol>
          {!user && !ended && <p className="live-chat-login"><Link to="/login">Entra</Link> para conversar e oferecer estrelas.</p>}
          {user && !ended && <>
            {!isHost && <div className="live-gifts">
              <button type="button" className="live-gift-open" aria-expanded={giftsOpen} onClick={() => setGiftsOpen(open => !open)}><Icon name="gift" size={15} /> Oferecer presente</button>
              <Link to="/estrelas" className="live-balance">{balance === null ? "" : `Saldo: ${formatCount(balance)} estrelas`}</Link>
            </div>}
            {!isHost && giftsOpen && <div className="live-gift-grid" role="list" aria-label="Presentes">
              {(config.gifts || []).map(item => <button key={item.key} type="button" role="listitem" className={`live-gift-option${item.sound ? " has-sound" : ""}`}
                onClick={() => gift(item.key)} disabled={balance !== null && balance < item.stars} title={`${item.name} · ${item.stars} estrelas`}>
                <GiftIcon gift={item.key} size={40} />
                <strong>{item.name}</strong>
                <span className="live-gift-stars"><Icon name="star" size={12} /> {formatCount(item.stars)} {item.stars === 1 ? "estrela" : "estrelas"}</span>
                <small>= {formatCount(item.kz)} Kz</small>
              </button>)}
              <p className="live-gift-hint">{balance !== null && <>Tens <strong>{formatCount(balance)} {balance === 1 ? "estrela" : "estrelas"}</strong>. </>}Cada presente paga-se com estrelas (1 estrela = 10 Kz); quem está em direto recebe 70%. <Link to="/estrelas">Comprar estrelas</Link></p>
            </div>}
            {giftMessage && <p className="live-gift-message" role="status">{giftMessage}</p>}
            <form className="live-chat-form" onSubmit={sendComment}>
              <input value={text} maxLength={300} onChange={event => setText(event.target.value)} placeholder="Escreve no chat..." aria-label="Mensagem para o chat" />
              <button className="round-button" type="submit" aria-label="Enviar" disabled={!text.trim()}><Icon name="send" size={17} /></button>
            </form>
          </>}
        </> : <ol className="supporters-list live-top">
          {!supporters.length && <li className="live-chat-empty">Ainda ninguém ofereceu estrelas neste direto.</li>}
          {supporters.map((person, index) => <li key={person.username}>
            <span className={`supporter-rank rank-${index + 1}`}>{index + 1}</span>
            <Avatar user={person} size="tiny" />
            <Link className="post-author" to={`/u/${person.username}`}>{person.display_name}</Link>
            <span className="supporter-stars"><Icon name="star" size={13} /> {formatCount(person.stars)}</span>
          </li>)}
        </ol>}
      </aside>
    </div>
  </div>;
}
