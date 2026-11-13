// Editores de imagem do perfil: posicionar a capa e recortar/filtrar a foto de perfil.
// Tudo corre no browser (canvas); o servidor volta a otimizar o resultado para WebP.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FlipHorizontal2, Minus, Move, Plus, RotateCw, Undo2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function useEscape(onClose) {
  useEffect(() => {
    const onKey = event => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function useLoadedImage(src) {
  const [image, setImage] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setImage(null);
    setFailed(false);
    if (!src) return undefined;
    const element = new Image();
    element.crossOrigin = "anonymous"; // permite exportar do canvas imagens servidas pela API
    element.onload = () => setImage(element);
    element.onerror = () => setFailed(true);
    element.src = src;
    return () => { element.onload = null; element.onerror = null; };
  }, [src]);
  return [image, failed];
}

function canvasToFile(canvas, baseName, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) return reject(new Error("Não foi possível preparar a imagem."));
      const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png";
      resolve(new File([blob], `${baseName}.${extension}`, { type: blob.type }));
    }, "image/webp", quality);
  });
}

// Reduz imagens grandes antes de as enviar (poupa dados móveis e tempo de envio).
// GIFs passam intactos para não perderem a animação; o servidor trata deles.
export async function downscaleImage(file, maxWidth, maxHeight, quality = 0.9) {
  if (!file?.type?.startsWith("image/") || file.type === "image/gif" || typeof createImageBitmap !== "function") return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
    bitmap.close?.();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  try {
    const result = await canvasToFile(canvas, (file.name || "imagem").replace(/\.[^.]+$/, ""), quality);
    return result.size < file.size ? result : file;
  } catch {
    return file;
  }
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Os editores são abertos a partir da capa, que redefine as cores do texto;
// por isso desenham-se diretamente no <body>, fora dessa herança.
const inBody = node => createPortal(node, document.body);

// ---------------------------------------------------------------------------
// Capa: arrastar na vertical para escolher a parte visível
// ---------------------------------------------------------------------------

export function CoverEditor({ src, initialPosition = 50, busy, error, onSave, onCancel }) {
  const [position, setPosition] = useState(clamp(Number(initialPosition) || 50, 0, 100));
  const [image, failed] = useLoadedImage(src);
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const [hiddenHeight, setHiddenHeight] = useState(0);
  useEscape(busy ? () => {} : onCancel);

  // Quantos píxeis da imagem ficam escondidos na vertical (o que se pode deslocar).
  useEffect(() => {
    const element = frameRef.current;
    if (!image || !element) return undefined;
    const measure = () => {
      const frame = element.getBoundingClientRect();
      const renderedHeight = Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight) * image.naturalHeight;
      setHiddenHeight(Math.max(0, renderedHeight - frame.height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [image]);

  const canMove = hiddenHeight > 1;

  const onPointerDown = event => {
    if (!canMove || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { y: event.clientY, position };
  };
  const onPointerMove = event => {
    if (!dragRef.current) return;
    const delta = event.clientY - dragRef.current.y;
    // Arrastar para baixo mostra mais do topo da imagem (posição diminui).
    setPosition(clamp(dragRef.current.position - (delta / hiddenHeight) * 100, 0, 100));
  };
  const endDrag = () => { dragRef.current = null; };
  const onKeyDown = event => {
    if (event.key === "ArrowUp") { event.preventDefault(); setPosition(value => clamp(value - 2, 0, 100)); }
    if (event.key === "ArrowDown") { event.preventDefault(); setPosition(value => clamp(value + 2, 0, 100)); }
  };

  return inBody(<div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div className="modal card photo-editor cover-editor" role="dialog" aria-modal="true" aria-labelledby="cover-editor-title">
      <div className="photo-editor-head">
        <h2 id="cover-editor-title">Posicionar capa</h2>
        <p className="muted">Arrasta a imagem para escolher a parte que aparece no teu perfil.</p>
      </div>
      <div ref={frameRef} className={`cover-editor-frame${canMove ? " can-move" : ""}`} tabIndex={canMove ? 0 : -1}
        aria-label="Pré-visualização da capa. Usa as setas para cima e para baixo para mover."
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={onKeyDown}>
        {image && <img src={src} alt="" draggable="false" style={{ objectPosition: `50% ${position}%` }} />}
        {!image && !failed && <span className="photo-editor-loading">A carregar imagem...</span>}
        {failed && <span className="photo-editor-loading">Não foi possível abrir esta imagem.</span>}
        {image && canMove && <span className="cover-editor-hint" aria-hidden="true"><Move size={16} /> Arrasta para reposicionar</span>}
      </div>
      {image && (canMove
        ? <label className="photo-editor-slider">
          <span>Posição</span>
          <input type="range" min="0" max="100" step="1" value={Math.round(position)} onChange={event => setPosition(Number(event.target.value))} aria-label="Posição vertical da capa" />
        </label>
        : <p className="muted photo-editor-note">Esta imagem já aparece inteira na capa, não há nada para ajustar.</p>)}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" disabled={busy} onClick={onCancel}>Cancelar</button>
        <button className="btn" type="button" disabled={busy || !image} onClick={() => onSave(Math.round(position))}>{busy ? "A guardar..." : "Guardar"}</button>
      </div>
    </div>
  </div>);
}

// ---------------------------------------------------------------------------
// Foto de perfil: recortar (zoom, mover, rodar, espelhar), filtros e ajustes
// ---------------------------------------------------------------------------

export const AVATAR_FILTERS = [
  { id: "original", label: "Original", css: "" },
  { id: "vivid", label: "Vívido", css: "saturate(1.35) contrast(1.08)" },
  { id: "warm", label: "Quente", css: "sepia(0.22) saturate(1.3) brightness(1.03)" },
  { id: "cool", label: "Frio", css: "hue-rotate(-12deg) saturate(1.1) brightness(1.04)" },
  { id: "soft", label: "Suave", css: "contrast(0.88) brightness(1.08) saturate(0.85)" },
  { id: "drama", label: "Dramático", css: "contrast(1.3) saturate(0.85) brightness(0.95)" },
  { id: "mono", label: "P&B", css: "grayscale(1) contrast(1.08)" },
  { id: "sepia", label: "Sépia", css: "sepia(0.85) contrast(1.02)" }
];

const ADJUSTMENTS = [
  ["brightness", "Brilho"],
  ["contrast", "Contraste"],
  ["saturation", "Saturação"]
];

const NO_ADJUSTMENTS = { brightness: 0, contrast: 0, saturation: 0 };
const AVATAR_OUTPUT = 640; // píxeis do ficheiro final (quadrado)
const MAX_ZOOM = 4;

function buildFilter(filterId, adjust) {
  const preset = AVATAR_FILTERS.find(item => item.id === filterId)?.css || "";
  const extra = [
    adjust.brightness ? `brightness(${1 + adjust.brightness / 100})` : "",
    adjust.contrast ? `contrast(${1 + adjust.contrast / 100})` : "",
    adjust.saturation ? `saturate(${1 + adjust.saturation / 100})` : ""
  ].filter(Boolean).join(" ");
  return [preset, extra].filter(Boolean).join(" ");
}

export function AvatarEditor({ src, busy, error, onSave, onCancel }) {
  const [image, failed] = useLoadedImage(src);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const [stageSize, setStageSize] = useState(320);
  const [tab, setTab] = useState("crop");
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [filterId, setFilterId] = useState("original");
  const [adjust, setAdjust] = useState(NO_ADJUSTMENTS);
  const [exportError, setExportError] = useState("");
  useEscape(busy ? () => {} : onCancel);

  useEffect(() => {
    if (!stageRef.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setStageSize(entry.contentRect.width));
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);

  // Geometria: a imagem cobre sempre o quadrado; o zoom aumenta a partir daí.
  const naturalWidth = image?.naturalWidth || 1;
  const naturalHeight = image?.naturalHeight || 1;
  const sideways = rotation % 180 !== 0;
  const boxWidth = sideways ? naturalHeight : naturalWidth;
  const boxHeight = sideways ? naturalWidth : naturalHeight;
  const scale = (stageSize / Math.min(boxWidth, boxHeight)) * zoom;
  const limitX = Math.max(0, (boxWidth * scale - stageSize) / 2);
  const limitY = Math.max(0, (boxHeight * scale - stageSize) / 2);
  const x = clamp(offset.x, -limitX, limitX);
  const y = clamp(offset.y, -limitY, limitY);
  const filter = buildFilter(filterId, adjust);

  const imageStyle = {
    width: naturalWidth * scale,
    height: naturalHeight * scale,
    transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${rotation}deg) scaleX(${flipped ? -1 : 1})`,
    filter: filter || "none"
  };

  const onPointerDown = event => {
    if (!image || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startY: event.clientY, x, y };
  };
  const onPointerMove = event => {
    if (!dragRef.current) return;
    const drag = dragRef.current;
    setOffset({ x: drag.x + event.clientX - drag.startX, y: drag.y + event.clientY - drag.startY });
  };
  const endDrag = () => { dragRef.current = null; };
  const onWheel = event => {
    if (!image) return;
    setZoom(value => clamp(value * (event.deltaY < 0 ? 1.08 : 1 / 1.08), 1, MAX_ZOOM));
  };
  const onKeyDown = event => {
    const step = 10;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[event.key]) {
      event.preventDefault();
      setOffset({ x: x + moves[event.key][0], y: y + moves[event.key][1] });
    } else if (event.key === "+" || event.key === "=") {
      setZoom(value => clamp(value + 0.1, 1, MAX_ZOOM));
    } else if (event.key === "-") {
      setZoom(value => clamp(value - 0.1, 1, MAX_ZOOM));
    }
  };

  const reset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setRotation(0);
    setFlipped(false);
    setFilterId("original");
    setAdjust(NO_ADJUSTMENTS);
  };

  const save = async () => {
    setExportError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_OUTPUT;
      canvas.height = AVATAR_OUTPUT;
      const context = canvas.getContext("2d");
      const ratio = AVATAR_OUTPUT / stageSize;
      context.filter = filter || "none";
      context.translate(AVATAR_OUTPUT / 2 + x * ratio, AVATAR_OUTPUT / 2 + y * ratio);
      context.rotate((rotation * Math.PI) / 180);
      context.scale(flipped ? -1 : 1, 1);
      const width = naturalWidth * scale * ratio;
      const height = naturalHeight * scale * ratio;
      context.drawImage(image, -width / 2, -height / 2, width, height);
      onSave(await canvasToFile(canvas, "foto-perfil", 0.92));
    } catch (saveError) {
      setExportError(saveError.name === "SecurityError" ? "Não foi possível editar esta imagem. Carrega-a novamente a partir do teu dispositivo." : saveError.message);
    }
  };

  return inBody(<div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div className="modal card photo-editor avatar-editor" role="dialog" aria-modal="true" aria-labelledby="avatar-editor-title">
      <div className="photo-editor-head">
        <h2 id="avatar-editor-title">Editar foto de perfil</h2>
        <button className="text-button" type="button" onClick={reset} disabled={busy || !image}><Undo2 size={15} /> Repor</button>
      </div>

      <div ref={stageRef} className="avatar-editor-stage" tabIndex={0}
        aria-label="Área de recorte. Arrasta ou usa as setas para mover; + e − para aproximar."
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onWheel={onWheel} onKeyDown={onKeyDown}>
        {image && <img src={src} alt="" draggable="false" style={imageStyle} />}
        {!image && !failed && <span className="photo-editor-loading">A carregar imagem...</span>}
        {failed && <span className="photo-editor-loading">Não foi possível abrir esta imagem.</span>}
        <span className="avatar-editor-mask" aria-hidden="true" />
      </div>

      <div className="photo-editor-tabs" role="tablist" aria-label="Ferramentas de edição">
        {[["crop", "Recortar"], ["filters", "Filtros"], ["adjust", "Ajustar"]].map(([id, label]) =>
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      <div className="photo-editor-panel" role="tabpanel">
        {tab === "crop" && <>
          <div className="photo-editor-zoom">
            <button className="icon-button" type="button" aria-label="Afastar" disabled={zoom <= 1} onClick={() => setZoom(value => clamp(value - 0.2, 1, MAX_ZOOM))}><Minus size={16} /></button>
            <input type="range" min="1" max={MAX_ZOOM} step="0.01" value={zoom} onChange={event => setZoom(Number(event.target.value))} aria-label="Zoom" />
            <button className="icon-button" type="button" aria-label="Aproximar" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(value => clamp(value + 0.2, 1, MAX_ZOOM))}><Plus size={16} /></button>
          </div>
          <div className="photo-editor-tools">
            <button className="btn secondary" type="button" onClick={() => setRotation(value => (value + 90) % 360)}><RotateCw size={16} /> Rodar</button>
            <button className="btn secondary" type="button" aria-pressed={flipped} onClick={() => setFlipped(value => !value)}><FlipHorizontal2 size={16} /> Espelhar</button>
          </div>
        </>}

        {tab === "filters" && <div className="avatar-filter-list">
          {AVATAR_FILTERS.map(item => <button key={item.id} type="button" className="avatar-filter" aria-pressed={filterId === item.id} onClick={() => setFilterId(item.id)}>
            <span className="avatar-filter-thumb">{image && <img src={src} alt="" style={{ filter: item.css || "none" }} />}</span>
            <span>{item.label}</span>
          </button>)}
        </div>}

        {tab === "adjust" && <div className="photo-editor-adjust">
          {ADJUSTMENTS.map(([key, label]) => <label key={key} className="photo-editor-slider">
            <span>{label}</span>
            <input type="range" min="-50" max="50" step="1" value={adjust[key]} onChange={event => setAdjust(current => ({ ...current, [key]: Number(event.target.value) }))} />
            <output>{adjust[key] > 0 ? `+${adjust[key]}` : adjust[key]}</output>
          </label>)}
        </div>}
      </div>

      {(error || exportError) && <p className="error" role="alert">{exportError || error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" disabled={busy} onClick={onCancel}>Cancelar</button>
        <button className="btn" type="button" disabled={busy || !image} onClick={save}>{busy ? "A guardar..." : "Guardar"}</button>
      </div>
    </div>
  </div>);
}
