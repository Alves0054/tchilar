import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { API_BASE, Avatar, DEFAULT_VIDEO_EDIT, Icon, UserContext, VIDEO_FILTERS, VIDEO_SPEEDS, VideoPlayer, api, formatClock } from "./core.jsx";
import { ExclusiveToggle, PostCard } from "./feed.jsx";
import { MUSIC_GENRE_LABELS, audioDuration } from "./shared.jsx";

// Partilhar um vídeo sem sair da página Reels: escolher, editar (cortar, velocidade, efeitos, texto,
// som), escrever a legenda e publicar. As edições seguem como instruções (videoEdit) e o leitor aplica-as.
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_CLIP_SECONDS = 180;
export const FILMSTRIP_FRAMES = 8;
// Tira fotogramas do vídeo escolhido para a tira do corte e para as miniaturas dos efeitos.
export function useVideoFrames(url) {
  const [state, setState] = useState({ duration: 0, frames: [] });
  useEffect(() => {
    if (!url) { setState({ duration: 0, frames: [] }); return undefined; }
    let cancelled = false;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    const seekTo = time => new Promise(resolve => {
      const done = () => { video.removeEventListener("seeked", done); resolve(); };
      video.addEventListener("seeked", done);
      video.currentTime = time;
    });
    video.addEventListener("loadedmetadata", async () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (cancelled) return;
      setState({ duration, frames: [] });
      const canvas = document.createElement("canvas");
      const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 9 / 16;
      canvas.height = 112;
      canvas.width = Math.round(112 * ratio);
      const context = canvas.getContext("2d");
      const frames = [];
      for (let index = 0; index < FILMSTRIP_FRAMES && !cancelled; index += 1) {
        try {
          await seekTo(Math.min(duration - 0.05, (duration * (index + 0.5)) / FILMSTRIP_FRAMES));
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push(canvas.toDataURL("image/jpeg", 0.7));
          if (!cancelled) setState({ duration, frames: [...frames] });
        } catch {
          break;
        }
      }
    }, { once: true });
    return () => { cancelled = true; video.removeAttribute("src"); video.load(); };
  }, [url]);
  return state;
}
export const REEL_TOOLS = [
  ["trim", "trim", "Cortar"],
  ["music", "sound", "Música"],
  ["effects", "effects", "Efeitos"],
  ["adjust", "adjust", "Ajustes"],
  ["text", "text", "Texto"],
  ["speed", "speed", "Velocidade"]
];
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
export const ADJUSTMENTS = [["brightness", "Brilho"], ["contrast", "Contraste"], ["saturation", "Saturação"]];
// Escolher música: biblioteca da Tchilar, as tuas músicas, pesquisa, géneros, ouvir antes e carregar a tua.
export function MusicPicker({ onSelect, onCancel }) {
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [previewId, setPreviewId] = useState(null);
  const [uploading, setUploading] = useState(null);    // { file, title, artist, rights, busy, error }
  const previewAudio = useRef(null);
  const fileInput = useRef(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (genre) params.set("genre", genre);
      api(`/music?${params}`).then(result => { setData(result); setError(""); }).catch(loadError => setError(loadError.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, genre]);
  useEffect(() => () => previewAudio.current?.pause(), []);

  const togglePreview = track => {
    const audio = previewAudio.current;
    if (!audio) return;
    if (previewId === track.id) { audio.pause(); setPreviewId(null); return; }
    audio.src = `${API_BASE}${track.audio_url}`;
    audio.currentTime = 0;
    audio.play().then(() => setPreviewId(track.id)).catch(() => setPreviewId(null));
  };
  const choose = track => { previewAudio.current?.pause(); setPreviewId(null); onSelect(track); };

  const pickFile = file => {
    if (!file) return;
    if (!file.type.startsWith("audio/")) return setError("Escolhe um ficheiro de áudio (MP3, M4A, AAC, WAV ou OGG).");
    if (file.size > MAX_AUDIO_BYTES) return setError("A música tem mais de 15 MB.");
    setError("");
    setUploading({ file, title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 100), artist: "", rights: false, busy: false, error: "" });
  };
  const upload = async () => {
    setUploading(current => ({ ...current, busy: true, error: "" }));
    try {
      const duration = await audioDuration(uploading.file).catch(() => { throw new Error("Não foi possível ler esta música. Experimenta outro ficheiro."); });
      const form = new FormData();
      form.append("audio", uploading.file);
      form.append("title", uploading.title);
      form.append("artist", uploading.artist);
      form.append("duration", String(duration));
      form.append("rightsConfirmed", String(uploading.rights));
      const result = await api("/music", { method: "POST", body: form });
      setUploading(null);
      choose(result.track);
    } catch (uploadError) {
      setUploading(current => ({ ...current, busy: false, error: uploadError.message }));
    }
  };
  const remove = async track => {
    if (!window.confirm(`Apagar "${track.title}" das tuas músicas?`)) return;
    try {
      await api(`/music/${track.id}`, { method: "DELETE" });
      setData(current => ({ ...current, mine: current.mine.filter(item => item.id !== track.id) }));
    } catch (removeError) {
      setError(removeError.message);
    }
  };

  const trackRow = (track, own) => <li key={track.id} className={`music-row ${previewId === track.id ? "is-previewing" : ""}`}>
    <button type="button" className="music-preview" aria-label={previewId === track.id ? `Parar ${track.title}` : `Ouvir ${track.title}`} onClick={() => togglePreview(track)}>
      <Icon name={previewId === track.id ? "pause" : "play"} size={16} />
    </button>
    <span className="music-info">
      <strong>{track.title}</strong>
      <small>{[track.artist, formatClock(track.duration), track.uses ? `${track.uses} ${track.uses === 1 ? "vídeo" : "vídeos"}` : null].filter(Boolean).join(" · ")}</small>
    </span>
    {own && !track.uses && <button type="button" className="music-delete" aria-label={`Apagar ${track.title}`} onClick={() => remove(track)}><Icon name="trash" size={15} /></button>}
    <button type="button" className="music-use" onClick={() => choose(track)}>Usar</button>
  </li>;

  return <div className="music-picker">
    <audio ref={previewAudio} onEnded={() => setPreviewId(null)} />
    <div className="music-search">
      <Icon name="search" size={16} />
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Procurar música ou artista" aria-label="Procurar música" />
    </div>
    <div className="music-genres" role="radiogroup" aria-label="Género">
      <button type="button" role="radio" aria-checked={!genre} className={!genre ? "active" : ""} onClick={() => setGenre("")}>Todas</button>
      {(data?.genres || Object.keys(MUSIC_GENRE_LABELS)).map(id => <button key={id} type="button" role="radio" aria-checked={genre === id}
        className={genre === id ? "active" : ""} onClick={() => setGenre(genre === id ? "" : id)}>{MUSIC_GENRE_LABELS[id] || id}</button>)}
    </div>
    {error && <p className="error" role="alert">{error}</p>}

    {uploading
      ? <div className="music-upload">
        <strong>Carregar música</strong>
        <label>Nome da música<input maxLength={100} value={uploading.title} onChange={event => setUploading({ ...uploading, title: event.target.value })} /></label>
        <label>Artista <small>opcional</small><input maxLength={100} value={uploading.artist} onChange={event => setUploading({ ...uploading, artist: event.target.value })} /></label>
        <label className="music-rights">
          <input type="checkbox" checked={uploading.rights} onChange={event => setUploading({ ...uploading, rights: event.target.checked })} />
          <span>Tenho direitos para usar esta música: é minha, tenho autorização do artista ou tem licença livre. Músicas com direitos de autor de outras pessoas podem ser removidas.</span>
        </label>
        {uploading.error && <p className="error" role="alert">{uploading.error}</p>}
        <div className="music-upload-actions">
          <button type="button" className="btn secondary" disabled={uploading.busy} onClick={() => setUploading(null)}>Cancelar</button>
          <button type="button" className="btn" disabled={uploading.busy || !uploading.rights || !uploading.title.trim()} onClick={upload}>{uploading.busy ? "A carregar..." : "Carregar e usar"}</button>
        </div>
      </div>
      : <button type="button" className="music-upload-button" onClick={() => fileInput.current.click()}><Icon name="plus" size={16} />Carregar música do telemóvel ou computador</button>}
    <input ref={fileInput} className="sr-only" type="file" accept="audio/*" tabIndex={-1} aria-hidden="true" onChange={event => { pickFile(event.target.files?.[0]); event.target.value = ""; }} />

    {!data && !error && <p className="reel-hint">A carregar músicas...</p>}
    {!!data?.mine?.length && <section><h3 className="music-heading">As tuas músicas</h3><ul className="music-list">{data.mine.map(track => trackRow(track, true))}</ul></section>}
    {data && <section>
      <h3 className="music-heading">Biblioteca da Tchilar</h3>
      {data.library.length
        ? <ul className="music-list">{data.library.map(track => trackRow(track, false))}</ul>
        : <p className="reel-hint">{query || genre ? "Nenhuma música encontrada. Experimenta outra pesquisa." : "A biblioteca ainda está vazia. Carrega uma música tua para usar já."}</p>}
    </section>}
    {onCancel && <button type="button" className="reel-reset" onClick={onCancel}>Voltar</button>}
  </div>;
}
export function ShareReelDialog({ onClose, onPosted }) {
  const { user } = useContext(UserContext);
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState("");
  const [exclusive, setExclusive] = useState(false);
  const [edit, setEdit] = useState(DEFAULT_VIDEO_EDIT);
  const [track, setTrack] = useState(null);           // música escolhida (dados para o leitor)
  const [pickingMusic, setPickingMusic] = useState(false);
  const [tool, setTool] = useState("trim");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const { duration, frames } = useVideoFrames(preview);
  useEffect(() => {
    const onKey = event => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  // Vídeo novo: edição do zero (mantém a música escolhida); vídeos com mais de 3 minutos ficam nos primeiros 3.
  useEffect(() => {
    setEdit(current => ({ ...DEFAULT_VIDEO_EDIT, music: current.music, end: duration > MAX_CLIP_SECONDS ? MAX_CLIP_SECONDS : null }));
  }, [duration]);

  const update = changes => setEdit(current => ({ ...current, ...changes }));
  const end = edit.end ?? duration;
  const clipSeconds = Math.max(0, end - edit.start);
  const finalSeconds = clipSeconds / edit.speed;
  const edited = edit.start > 0 || (edit.end !== null && edit.end < duration - 0.05) || edit.speed !== 1 || edit.filter !== "none"
    || edit.originalVolume !== 1 || edit.brightness !== 100 || edit.contrast !== 100 || edit.saturation !== 100 || edit.mirror
    || edit.music || edit.text.trim();
  const maxMusicOffset = track ? Math.max(0, track.duration - Math.min(finalSeconds, track.duration)) : 0;

  const choose = picked => {
    setError("");
    if (!picked) return;
    if (!picked.type.startsWith("video/")) return setError("Escolhe um ficheiro de vídeo.");
    if (picked.size > MAX_VIDEO_BYTES) return setError("O vídeo tem mais de 100 MB. Escolhe um mais curto.");
    setFile(picked);
    setTool("trim");
  };

  const selectTrack = picked => {
    setTrack(picked);
    setPickingMusic(false);
    // Com música, o som do vídeo baixa para 30% (a música fica em destaque); ajusta-se nos controlos.
    update({ music: { trackId: picked.id, offset: 0, volume: 1, fade: true }, originalVolume: edit.music ? edit.originalVolume : Math.min(edit.originalVolume, 0.3) });
  };
  const removeTrack = () => {
    setTrack(null);
    update({ music: null, originalVolume: 1 });
  };
  const updateMusic = changes => update({ music: { ...edit.music, ...changes } });

  // Os dois puxadores do corte: o início não passa o fim (e vice-versa) e o reel não passa de 3 minutos.
  const setStart = value => {
    const start = Math.min(Number(value), end - 0.5);
    update({ start: Math.max(0, Math.round(start * 10) / 10), end: end - start > MAX_CLIP_SECONDS ? start + MAX_CLIP_SECONDS : edit.end });
  };
  const setEnd = value => {
    const next = Math.max(Number(value), edit.start + 0.5);
    const clamped = Math.min(next, edit.start + MAX_CLIP_SECONDS);
    update({ end: clamped >= duration - 0.05 ? null : Math.round(clamped * 10) / 10 });
  };

  const resetAll = () => {
    setTrack(null);
    setEdit({ ...DEFAULT_VIDEO_EDIT, end: duration > MAX_CLIP_SECONDS ? MAX_CLIP_SECONDS : null });
  };

  const submit = async event => {
    event.preventDefault();
    if (!file) return setError("Escolhe primeiro um vídeo.");
    setBusy(true);
    setError("");
    const formData = new FormData();
    formData.append("body", caption);
    formData.append("media", file);
    if (exclusive) formData.append("isExclusive", "true");
    if (edited) {
      const { text, textPosition, textStyle, muted: _muted, music, ...rest } = edit;
      formData.append("videoEdit", JSON.stringify({
        ...rest,
        ...(music && { music }),
        ...(text.trim() && { text: text.trim(), textPosition, textStyle })
      }));
    }
    try {
      const result = await api("/posts", { method: "POST", body: formData });
      onPosted(result.post);
    } catch (submitError) {
      setError(submitError.message);
      setBusy(false);
    }
  };

  const percent = value => (duration ? `${(value / duration) * 100}%` : "0%");
  const thumb = frames[Math.min(frames.length - 1, 2)] || frames[0];
  const playerMusic = track ? { title: track.title, artist: track.artist, src: `${API_BASE}${track.audio_url}` } : null;
  const toolDot = id => ({
    trim: edit.start > 0 || (edit.end !== null && edit.end < duration - 0.05),
    music: Boolean(edit.music),
    effects: edit.filter !== "none",
    adjust: edit.brightness !== 100 || edit.contrast !== 100 || edit.saturation !== 100 || edit.mirror,
    text: Boolean(edit.text.trim()),
    speed: edit.speed !== 1
  })[id];

  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card share-reel-dialog" role="dialog" aria-modal="true" aria-labelledby="share-reel-title" onSubmit={submit}>
      <div className="share-dialog-head">
        <h2 id="share-reel-title">{file ? "Editar e partilhar" : "Partilhar vídeo"}</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      <input ref={fileInput} className="sr-only" type="file" accept="video/*" tabIndex={-1} aria-hidden="true"
        onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
      <div className="share-reel-grid">
        {file
          ? <div className="share-reel-preview">
            <VideoPlayer key={preview} src={preview} edit={edit} music={playerMusic} label="Pré-visualização do teu vídeo" />
            <button type="button" className="share-reel-change" onClick={() => fileInput.current.click()} disabled={busy}><Icon name="video" size={15} />Trocar</button>
          </div>
          : <button type="button" className="share-reel-pick" onClick={() => fileInput.current.click()}
            onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); choose(event.dataTransfer.files?.[0]); }}>
            <span className="share-reel-pick-icon"><Icon name="video" size={28} /></span>
            <strong>Escolher vídeo</strong>
            <small>Do telemóvel ou do computador, até 100 MB. Vídeos ao alto ficam melhor.</small>
          </button>}

        <div className="share-reel-fields">
          {file && <section className="reel-editor" aria-label="Editar o vídeo">
            <div className="reel-tools" role="tablist" aria-label="Ferramentas">
              {REEL_TOOLS.map(([id, icon, label]) => <button key={id} type="button" role="tab" aria-selected={tool === id}
                className={tool === id ? "active" : ""} onClick={() => setTool(id)}>
                <span className="reel-tool-icon"><Icon name={icon} size={18} />{toolDot(id) && <i className="reel-tool-dot" aria-label="(alterado)" />}</span>
                <span>{label}</span>
              </button>)}
            </div>

            <div className="reel-tool-panel" role="tabpanel">
              {tool === "trim" && <>
                <div className="reel-trim">
                  <div className="reel-filmstrip" aria-hidden="true">
                    {frames.length ? frames.map((src, index) => <img key={index} src={src} alt="" />) : <span className="reel-filmstrip-loading">A preparar o vídeo...</span>}
                  </div>
                  <span className="reel-trim-shade" style={{ left: 0, width: percent(edit.start) }} />
                  <span className="reel-trim-shade" style={{ left: percent(end), right: 0 }} />
                  <span className="reel-trim-window" style={{ left: percent(edit.start), width: percent(clipSeconds) }} />
                  <input type="range" className="reel-trim-handle" min="0" max={duration || 0} step="0.1" value={edit.start}
                    aria-label="Início do vídeo" aria-valuetext={formatClock(edit.start)} onChange={event => setStart(event.target.value)} disabled={!duration} />
                  <input type="range" className="reel-trim-handle" min="0" max={duration || 0} step="0.1" value={end}
                    aria-label="Fim do vídeo" aria-valuetext={formatClock(end)} onChange={event => setEnd(event.target.value)} disabled={!duration} />
                </div>
                <p className="reel-trim-info">
                  <span>Início <strong>{formatClock(edit.start)}</strong></span>
                  <span>Fim <strong>{formatClock(end)}</strong></span>
                  <span>Duração final <strong>{formatClock(Math.ceil(finalSeconds))}</strong></span>
                </p>
                {duration > MAX_CLIP_SECONDS && <p className="reel-hint">Os reels podem ter até 3 minutos. Arrasta para escolher a melhor parte.</p>}
              </>}

              {tool === "music" && (pickingMusic || !track
                ? <MusicPicker onSelect={selectTrack} onCancel={track ? () => setPickingMusic(false) : null} />
                : <div className="music-selected">
                  <div className="music-selected-card">
                    <span className="music-selected-icon"><Icon name="sound" size={20} /></span>
                    <span className="music-info"><strong>{track.title}</strong><small>{[track.artist, formatClock(track.duration)].filter(Boolean).join(" · ")}</small></span>
                    <button type="button" className="music-use" onClick={() => setPickingMusic(true)}>Trocar</button>
                    <button type="button" className="music-delete" aria-label="Tirar a música" onClick={removeTrack}><Icon name="close" size={15} /></button>
                  </div>
                  {maxMusicOffset > 0 && <label className="reel-slider">
                    <span>Começar a música em <strong>{formatClock(edit.music.offset)}</strong></span>
                    <input type="range" min="0" max={maxMusicOffset} step="0.5" value={Math.min(edit.music.offset, maxMusicOffset)}
                      onChange={event => updateMusic({ offset: Number(event.target.value) })} />
                    <small>Escolhe a parte da música que fica melhor com o vídeo (o refrão, por exemplo).</small>
                  </label>}
                  <label className="reel-slider">
                    <span>Volume da música <strong>{Math.round(edit.music.volume * 100)}%</strong></span>
                    <input type="range" min="0" max="1" step="0.05" value={edit.music.volume} onChange={event => updateMusic({ volume: Number(event.target.value) })} />
                  </label>
                  <label className="reel-slider">
                    <span>Som do vídeo <strong>{edit.originalVolume === 0 ? "sem som" : `${Math.round(edit.originalVolume * 100)}%`}</strong></span>
                    <input type="range" min="0" max="1" step="0.05" value={edit.originalVolume} onChange={event => update({ originalVolume: Number(event.target.value) })} />
                  </label>
                  <label className="reel-sound-toggle">
                    <input type="checkbox" checked={edit.music.fade} onChange={event => updateMusic({ fade: event.target.checked })} />
                    <span className="entry-switch-track" aria-hidden="true"><i /></span>
                    <span><strong>Entrada e saída suaves</strong><small>A música aumenta no início e baixa no fim do vídeo.</small></span>
                  </label>
                  <p className="reel-hint">Ativa o som na pré-visualização para ouvires a mistura.</p>
                </div>)}

              {tool === "effects" && <div className="reel-effects" role="radiogroup" aria-label="Efeitos">
                {VIDEO_FILTERS.map(([id, label, css]) => <button key={id} type="button" role="radio" aria-checked={edit.filter === id}
                  className={edit.filter === id ? "active" : ""} onClick={() => update({ filter: id })}>
                  <span className="reel-effect-thumb">{thumb ? <img src={thumb} alt="" style={{ filter: css }} /> : <i style={{ filter: css }} />}</span>
                  <small>{label}</small>
                </button>)}
              </div>}

              {tool === "adjust" && <div className="reel-adjust">
                {ADJUSTMENTS.map(([key, label]) => <label key={key} className="reel-slider">
                  <span>{label} <strong>{edit[key] > 100 ? "+" : ""}{edit[key] - 100}</strong></span>
                  <input type="range" min="50" max="150" step="1" value={edit[key]} onChange={event => update({ [key]: Number(event.target.value) })}
                    onDoubleClick={() => update({ [key]: 100 })} />
                </label>)}
                <label className="reel-sound-toggle">
                  <input type="checkbox" checked={edit.mirror} onChange={event => update({ mirror: event.target.checked })} />
                  <span className="entry-switch-track" aria-hidden="true"><i /></span>
                  <span><strong>Espelhar</strong><small>Vira o vídeo da esquerda para a direita (útil em vídeos da câmara da frente).</small></span>
                </label>
                {(edit.brightness !== 100 || edit.contrast !== 100 || edit.saturation !== 100) &&
                  <button type="button" className="reel-reset" onClick={() => update({ brightness: 100, contrast: 100, saturation: 100 })}><Icon name="reset" size={14} />Repor ajustes</button>}
              </div>}

              {tool === "text" && <div className="reel-text-tool">
                <label>Texto no vídeo <small>{edit.text.length}/80</small>
                  <input maxLength={80} value={edit.text} onChange={event => update({ text: event.target.value })} placeholder="Ex.: Sábado na Ilha de Luanda" />
                </label>
                <div className="reel-chips" role="radiogroup" aria-label="Posição do texto">
                  {[["top", "Em cima"], ["center", "Ao meio"], ["bottom", "Em baixo"]].map(([value, label]) => <button key={value} type="button" role="radio"
                    aria-checked={edit.textPosition === value} className={edit.textPosition === value ? "active" : ""} onClick={() => update({ textPosition: value })}>{label}</button>)}
                </div>
                <div className="reel-chips reel-text-styles" role="radiogroup" aria-label="Estilo do texto">
                  {[["clean", "Simples"], ["box", "Caixa"], ["coral", "Coral"]].map(([value, label]) => <button key={value} type="button" role="radio"
                    aria-checked={edit.textStyle === value} className={`${edit.textStyle === value ? "active" : ""} sample-${value}`} onClick={() => update({ textStyle: value })}><span>{label}</span></button>)}
                </div>
              </div>}

              {tool === "speed" && <div className="reel-chips" role="radiogroup" aria-label="Velocidade">
                {VIDEO_SPEEDS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={edit.speed === value}
                  className={edit.speed === value ? "active" : ""} onClick={() => update({ speed: value })}>{label}</button>)}
                <p className="reel-hint">{edit.speed < 1 ? "Câmara lenta: ótimo para danças e momentos especiais." : edit.speed > 1 ? "Acelerado: bom para receitas, viagens e tutoriais." : "Velocidade normal."} A música toca sempre à velocidade normal.</p>
              </div>}
            </div>
            {edited && <button type="button" className="reel-reset" onClick={resetAll}><Icon name="reset" size={14} />Repor o original</button>}
          </section>}

          <div className="share-reel-author"><Avatar user={user} size="tiny" /><strong>{user?.display_name}</strong></div>
          <label>Legenda <small>{caption.length}/5000</small>
            <textarea rows={file ? 3 : 5} maxLength={5000} value={caption} onChange={event => setCaption(event.target.value)} placeholder="Conta o que se passa no vídeo..." />
          </label>
          <ExclusiveToggle user={user} checked={exclusive} onChange={setExclusive} />
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy || !file}>{busy ? "A publicar o vídeo..." : "Publicar"}</button>
      </div>
    </form>
  </div>, document.body);
}
export function Reels() {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState("");
  const [posts, setPosts] = useState([]);
  const [sponsoredReels, setSponsoredReels] = useState([]);
  useEffect(() => { api("/ads/feed?placement=reels").then(result => setSponsoredReels(result.posts)).catch(() => {}); }, []);
  const reelItems = useMemo(() => {
    const ids = new Set(posts.map(post => post.id));
    const items = posts.map(post => ({ key: post.id, post }));
    sponsoredReels.filter(post => !ids.has(post.id)).forEach((post, index) => {
      items.splice(Math.min(2 + index * 5, items.length), 0, { key: `sponsored-${post.sponsored.ad_id}`, post });
    });
    return items;
  }, [posts, sponsoredReels]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setError("");
    try {
      const result = await api("/posts?mediaType=video");
      setPosts(result.posts);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Sem sessão iniciada é preciso entrar primeiro; com sessão, tudo acontece aqui mesmo.
  const startSharing = () => (user ? setSharing(true) : navigate("/login"));
  const onPosted = post => {
    setSharing(false);
    if (post) setPosts(current => [{ ...post, username: user.username, display_name: user.display_name, avatar_url: user.avatar_url, likes: 0, comments: 0 }, ...current]);
    setNotice("O teu vídeo foi publicado.");
    window.scrollTo({ top: 0, behavior: "smooth" });
    load();
  };

  return <section className="page narrow reels-page">
    <header className="reels-heading">
      <span className="reels-heading-icon"><Icon name="reels" size={22} /></span>
      <div><p className="feed-section-kicker">Vídeos da comunidade</p><h1>Reels</h1><p>Momentos em vídeo partilhados por quem está no Tchilar.</p></div>
      <button className="reels-create-link" type="button" onClick={startSharing}><Icon name="camera" size={16} />Partilhar vídeo</button>
    </header>
    {notice && <p className="settings-form-success reels-notice" role="status"><Icon name="check" size={14} />{notice}</p>}
    {loading && <div className="empty card">A carregar vídeos...</div>}
    {error && <div className="empty card error">{error}</div>}
    {!loading && !error && !posts.length && <div className="reels-empty card"><span className="reels-empty-icon"><Icon name="video" size={25} /></span><h2>Ainda não há Reels</h2><p>Quando alguém partilhar um vídeo, vais encontrá-lo aqui. Também podes ser a primeira pessoa a publicar.</p><button className="btn" type="button" onClick={startSharing}>Partilhar vídeo</button></div>}
    {sharing && <ShareReelDialog onClose={() => setSharing(false)} onPosted={onPosted} />}
    {!loading && !error && <div className="reels-list">{reelItems.map(item => <PostCard key={item.key} post={item.post} onChanged={load} />)}</div>}
  </section>;
}
