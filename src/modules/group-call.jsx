// Chamadas de voz e vídeo nos grupos (site). Cada participante liga-se diretamente a cada um dos outros
// (malha WebRTC, até 8 pessoas). A API faz só a sinalização (server/group-calls.js):
// - a cada 2,5 s: sinal de vida → quem está na chamada + ofertas/respostas para mim;
// - entre duas pessoas, quem tem o número de utilizador mais baixo envia a oferta;
// - a oferta e a resposta vão completas (esperamos pelos candidatos ICE), como nos diretos.
import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Avatar, Icon, UserContext, api } from "./core.jsx";
import { usePolling } from "./shared.jsx";

const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const waitForIce = (pc, timeout = 3000) => new Promise(resolve => {
  if (pc.iceGatheringState === "complete") return resolve();
  const timer = window.setTimeout(resolve, timeout);
  pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { window.clearTimeout(timer); resolve(); } });
});

// Aviso no topo do grupo: há uma chamada a decorrer (entrar) ou botões para começar uma.
export function GroupCallBar({ group, onJoin }) {
  const [call, setCall] = useState(undefined);
  const load = () => api(`/groups/${group.id}/call`).then(result => setCall(result.call)).catch(() => setCall(null));
  useEffect(() => { load(); }, [group.id]);
  usePolling(load, 10000, true);
  if (call === undefined) return null;
  if (call) return <div className="group-call-bar is-live" role="status">
    <span className="group-call-pulse" aria-hidden="true" />
    <span className="group-call-bar-text"><strong>Chamada de {call.kind === "voice" ? "voz" : "vídeo"} a decorrer</strong>
      <small>{call.participants.map(p => p.display_name).slice(0, 3).join(", ")}{call.participants.length > 3 ? ` e mais ${call.participants.length - 3}` : ""}</small></span>
    <span className="group-call-faces">{call.participants.slice(0, 4).map(p => <Avatar key={p.user_id} user={p} size="tiny" />)}</span>
    <button className="btn" type="button" onClick={() => onJoin(call.kind)}><Icon name={call.kind === "voice" ? "mic" : "video"} size={15} /> Entrar</button>
  </div>;
  return <div className="group-call-bar">
    <span className="group-call-bar-text"><strong>Falar com o grupo</strong><small>Até 8 pessoas ao mesmo tempo.</small></span>
    <button className="btn secondary" type="button" onClick={() => onJoin("voice")}><Icon name="mic" size={15} /> Chamada de voz</button>
    <button className="btn" type="button" onClick={() => onJoin("video")}><Icon name="video" size={15} /> Chamada de vídeo</button>
  </div>;
}

function Tile({ person, stream, local = false, kind }) {
  const videoRef = useRef(null);
  useEffect(() => { if (videoRef.current && videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream || null; }, [stream]);
  const showVideo = kind === "video" && person.camera !== false && stream?.getVideoTracks().length > 0;
  return <div className={`group-call-tile${showVideo ? "" : " is-audio"}`}>
    {/* O <video> toca também o som dos outros (o nosso fica mudo para não haver eco). */}
    <video ref={videoRef} autoPlay playsInline muted={local} style={{ visibility: showVideo ? "visible" : "hidden" }} className={local ? "is-mirrored" : ""} />
    {!showVideo && <span className="group-call-avatar"><Avatar user={person} size="large" /></span>}
    <span className="group-call-name">{person.muted && <Icon name="micOff" size={13} />} {local ? "Tu" : person.display_name}{!stream && !local ? " · a ligar…" : ""}</span>
  </div>;
}

// Chamada num grupo.
export function GroupCallRoom({ group, kind, me, onClose }) {
  return <CallRoom title={group.name} base={`/groups/${group.id}/call`} kind={kind} me={me} onClose={onClose}
    start={wanted => api(`/groups/${group.id}/call`, json("POST", { kind: wanted }))} />;
}

// Ecrã da chamada (por cima de tudo), para grupos e para chamadas das mensagens.
// base: caminho da API da chamada (…/heartbeat, …/signal, …/leave); start: entra (ou começa) e devolve a configuração.
// direct: chamada das mensagens (mostra quem está a ser chamado e deixa adicionar pessoas).
export function CallRoom({ title, base, start, kind: wantedKind, me, onClose, direct = false }) {
  const [state, setState] = useState("starting"); // starting | live | error
  const [error, setError] = useState("");
  const [call, setCall] = useState(null);
  const [local, setLocal] = useState(null);
  const [remote, setRemote] = useState({});       // userId → MediaStream
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(wantedKind === "video");
  const config = useRef(null);
  const localRef = useRef(null);
  const peers = useRef(new Map());                // userId → { pc, joinedAt }
  const busy = useRef(false);
  const flags = useRef({ muted: false, camera: wantedKind === "video" });
  // O caminho da chamada pode mudar depois de a criar ("/calls/new" → "/calls/12"): usa-se sempre o mais recente.
  const baseRef = useRef(base);
  baseRef.current = base;

  const signal = (to, kind, payload = "") => api(`${baseRef.current}/signal`, json("POST", { to, kind, payload })).catch(() => {});
  const dropPeer = userId => {
    peers.current.get(userId)?.pc.close();
    peers.current.delete(userId);
    setRemote(current => { const next = { ...current }; delete next[userId]; return next; });
  };
  const newPeer = (userId, joinedAt) => {
    dropPeer(userId);
    const pc = new RTCPeerConnection({ iceServers: config.current.iceServers, iceTransportPolicy: config.current.iceTransportPolicy || "all" });
    localRef.current.getTracks().forEach(track => pc.addTrack(track, localRef.current));
    pc.addEventListener("track", event => setRemote(current => ({ ...current, [userId]: event.streams[0] })));
    pc.addEventListener("connectionstatechange", () => { if (["failed", "closed"].includes(pc.connectionState) && peers.current.get(userId)?.pc === pc) dropPeer(userId); });
    peers.current.set(userId, { pc, joinedAt });
    return pc;
  };
  const offerTo = async person => {
    const pc = newPeer(person.user_id, person.joined_at);
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc);
    await signal(person.user_id, "offer", JSON.stringify({ sdp: pc.localDescription.sdp }));
  };
  const answer = async (from, payload, joinedAt) => {
    const pc = newPeer(from, joinedAt);
    await pc.setRemoteDescription({ type: "offer", sdp: JSON.parse(payload).sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIce(pc);
    await signal(from, "answer", JSON.stringify({ sdp: pc.localDescription.sdp }));
  };

  // Entrar: câmara/microfone primeiro (para o browser pedir autorização), depois a chamada.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof RTCPeerConnection !== "function" || !navigator.mediaDevices?.getUserMedia) throw new Error("Este browser não faz chamadas. Experimenta o Chrome, o Edge, o Firefox ou o Safari atualizados.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: wantedKind === "video" ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } : false });
      if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
      localRef.current = stream;
      setLocal(stream);
      const result = await start(wantedKind);
      config.current = result;
      setCall(result.call);
      // Se entrámos numa chamada de voz com a câmara pedida, desligamos o vídeo.
      if (result.call.kind === "voice") { stream.getVideoTracks().forEach(track => { track.stop(); stream.removeTrack(track); }); setCamOn(false); flags.current.camera = false; }
      setState("live");
    })().catch(startError => {
      if (cancelled) return;
      setState("error");
      setError(startError.name === "NotAllowedError" ? "Autoriza o microfone (e a câmara) no browser para entrares na chamada." : startError.message);
    });
    return () => {
      cancelled = true;
      peers.current.forEach(({ pc }) => pc.close());
      peers.current.clear();
      localRef.current?.getTracks().forEach(track => track.stop());
      if (config.current) api(`${baseRef.current}/leave`, { method: "POST" }).catch(() => {});
    };
  }, []);

  // Sinal de vida: quem está, sinais para mim, e ligar a quem ainda não está ligado.
  const beat = async () => {
    if (state !== "live" || busy.current) return;
    busy.current = true;
    try {
      const result = await api(`${baseRef.current}/heartbeat`, json("POST", flags.current));
      if (!result.call) { setState("error"); setError("A chamada terminou."); return; }
      setCall(result.call);
      const others = result.call.participants.filter(person => person.user_id !== me.id);
      for (const item of result.signals) {
        const person = others.find(p => p.user_id === item.from_user);
        if (item.kind === "offer") await answer(item.from_user, item.payload, person?.joined_at).catch(() => {});
        if (item.kind === "answer") {
          const peer = peers.current.get(item.from_user);
          if (peer?.pc.signalingState === "have-local-offer") await peer.pc.setRemoteDescription({ type: "answer", sdp: JSON.parse(item.payload).sdp }).catch(() => dropPeer(item.from_user));
        }
        if (item.kind === "bye") dropPeer(item.from_user);
      }
      // Quem saiu (ou voltou a entrar): fecha a ligação antiga.
      for (const [userId, peer] of peers.current) {
        const person = others.find(p => p.user_id === userId);
        if (!person || (peer.joinedAt && person.joined_at !== peer.joinedAt)) dropPeer(userId);
      }
      // Eu ofereço a quem tem número maior e ainda não tem ligação.
      for (const person of others) if (me.id < person.user_id && !peers.current.has(person.user_id)) await offerTo(person).catch(() => dropPeer(person.user_id));
    } catch { /* falha de rede: tenta no próximo */ }
    finally { busy.current = false; }
  };
  usePolling(beat, 2500, state === "live");
  // Chamada das mensagens: se ninguém atender em 50 s, desliga.
  const answered = useRef(false);
  useEffect(() => { if ((call?.participants || []).length > 1) answered.current = true; }, [call]);
  useEffect(() => {
    if (!direct || state !== "live") return undefined;
    const timer = window.setTimeout(() => { if (!answered.current) { setState("error"); setError("Ninguém atendeu."); } }, 50000);
    return () => window.clearTimeout(timer);
  }, [direct, state]);
  useEffect(() => { if (state === "live") beat(); }, [state]);

  const toggleMic = () => { const next = !micOn; localRef.current?.getAudioTracks().forEach(track => { track.enabled = next; }); flags.current.muted = !next; setMicOn(next); };
  const toggleCam = () => { const next = !camOn; localRef.current?.getVideoTracks().forEach(track => { track.enabled = next; }); flags.current.camera = next; setCamOn(next); };
  const kind = call?.kind || wantedKind;
  const others = (call?.participants || []).filter(person => person.user_id !== me.id);
  const meTile = { ...me, user_id: me.id, muted: !micOn, camera: camOn };
  const count = call?.participants.length || 1;
  // Chamada das mensagens: quem ainda está a ser chamado (convidado, não recusou, ainda não entrou).
  const ringing = (call?.invited || []).filter(person => !person.declined);
  const addPerson = async () => {
    const username = window.prompt("Adicionar à chamada (nome de utilizador):");
    if (!username?.trim()) return;
    try { await api(`${baseRef.current}/invite`, json("POST", { username: username.trim() })); }
    catch (inviteError) { window.alert(inviteError.message); }
  };

  return createPortal(<div className="group-call-room" role="dialog" aria-modal="true" aria-label={`Chamada: ${title}`}>
    <header className="group-call-head">
      <span><strong>{title}</strong><small>Chamada de {kind === "voice" ? "voz" : "vídeo"} · {count} {count === 1 ? "pessoa" : "pessoas"}</small></span>
    </header>
    {state === "error" ? <div className="group-call-message"><Icon name="info" size={30} /><p>{error}</p><button className="btn" type="button" onClick={onClose}>Fechar</button></div>
      : <div className={`group-call-grid is-${Math.min(others.length + 1, 6)}`}>
        <Tile person={meTile} stream={local} local kind={kind} />
        {others.map(person => <Tile key={person.user_id} person={person} stream={remote[person.user_id]} kind={kind} />)}
        {state === "starting" && <p className="group-call-wait">A ligar o microfone{wantedKind === "video" ? " e a câmara" : ""}…</p>}
        {state === "live" && !others.length && <p className="group-call-wait">{direct
          ? (ringing.length ? `A chamar ${ringing.map(p => p.display_name).join(", ")}…` : "Ninguém está a ser chamado.")
          : "À espera dos outros membros… avisámos o grupo."}</p>}
        {state === "live" && others.length > 0 && ringing.length > 0 && <p className="group-call-wait">A chamar {ringing.map(p => p.display_name).join(", ")}…</p>}
      </div>}
    <footer className="group-call-controls">
      <button type="button" className={`group-call-btn${micOn ? "" : " is-off"}`} onClick={toggleMic} disabled={state !== "live"} aria-pressed={!micOn} aria-label={micOn ? "Desligar microfone" : "Ligar microfone"}><Icon name={micOn ? "mic" : "micOff"} size={22} /></button>
      {kind === "video" && <button type="button" className={`group-call-btn${camOn ? "" : " is-off"}`} onClick={toggleCam} disabled={state !== "live"} aria-pressed={!camOn} aria-label={camOn ? "Desligar câmara" : "Ligar câmara"}><Icon name={camOn ? "video" : "videoOff"} size={22} /></button>}
      {direct && <button type="button" className="group-call-btn" onClick={addPerson} disabled={state !== "live" || count >= 8} aria-label="Adicionar pessoa à chamada"><Icon name="plus" size={22} /></button>}
      <button type="button" className="group-call-btn is-leave" onClick={onClose} aria-label="Sair da chamada"><Icon name="hangup" size={22} /></button>
    </footer>
  </div>, document.body);
}

// "Está a ligar-te": pergunta de 4 em 4 segundos e mostra a chamada a tocar (com som), em qualquer página.
export function IncomingCall({ user, onAnswer }) {
  const [call, setCall] = useState(null);
  const dismissed = useRef(new Set());
  const audio = useRef(null);
  usePolling(async () => {
    const result = await api("/calls/incoming");
    setCall(result.call && !dismissed.current.has(result.call.id) ? result.call : null);
  }, 4000, Boolean(user));
  useEffect(() => {
    if (!call) { audio.current?.pause(); return undefined; }
    audio.current = audio.current || new Audio("/sounds/gift-2.wav");
    const ring = () => { audio.current.currentTime = 0; audio.current.play().catch(() => {}); };
    ring();
    const timer = window.setInterval(ring, 2500);
    return () => { window.clearInterval(timer); audio.current?.pause(); };
  }, [call?.id]);
  if (!call) return null;
  const decline = () => { dismissed.current.add(call.id); setCall(null); api(`/calls/${call.id}/decline`, { method: "POST" }).catch(() => {}); };
  const answer = () => { dismissed.current.add(call.id); setCall(null); onAnswer(call); };
  return createPortal(<div className="incoming-call" role="alertdialog" aria-label={`${call.caller_name} está a ligar-te`}>
    <Avatar user={{ display_name: call.caller_name, avatar_url: call.caller_avatar }} size="small" />
    <span className="incoming-call-text"><strong>{call.caller_name}</strong><small>{call.kind === "voice" ? "Chamada de voz" : "Chamada de vídeo"}{call.count > 1 ? ` · ${call.count} pessoas` : ""}</small></span>
    <button type="button" className="group-call-btn is-leave" onClick={decline} aria-label="Recusar"><Icon name="hangup" size={20} /></button>
    <button type="button" className="group-call-btn is-answer" onClick={answer} aria-label="Atender"><Icon name={call.kind === "voice" ? "mic" : "video"} size={20} /></button>
  </div>, document.body);
}

export function CallPage() {
  const { callId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, authReady } = useContext(UserContext);
  const [id, setId] = useState(callId === "new" ? null : callId);
  const close = () => (window.history.length > 1 ? navigate(-1) : navigate("/messages"));
  if (!authReady) return null;
  if (!user) return <div className="page narrow"><div className="empty card">Entra na tua conta para fazeres chamadas.</div></div>;
  const kind = params.get("kind") === "voice" ? "voice" : "video";
  // Ligar: cria a chamada e passa o endereço para /calls/:id (sem recarregar), para um "atualizar" voltar à mesma.
  const start = async wanted => {
    if (id) return api(`/calls/${id}/join`, json("POST", {}));
    const result = await api("/calls", json("POST", { to: [Number(params.get("to"))], kind: wanted }));
    setId(String(result.call.id));
    window.history.replaceState(window.history.state, "", `/calls/${result.call.id}`);
    return result;
  };
  return <CallRoom key={callId === "new" ? "new" : callId} title={params.get("name") || "Chamada"} base={id ? `/calls/${id}` : "/calls/pending"}
    start={start} kind={kind} me={user} onClose={close} direct />;
}
