// Campo de ficheiro do Tchilar: substitui o "Escolher ficheiro · Nenhum ficheiro selecionado" do browser.
// Escolher ou arrastar para cá; depois mostra a miniatura (imagem ou vídeo), o nome, o tamanho, "Trocar" e "Remover".
// onChange(file) recebe o File escolhido, ou null quando se remove.
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./core.jsx";
import "./file-picker.css";

const KINDS = {
  image: { icon: "image", title: "Escolher imagem", noun: "a imagem" },
  video: { icon: "video", title: "Escolher vídeo", noun: "o vídeo" },
  file: { icon: "layers", title: "Escolher ficheiro", noun: "o ficheiro" }
};
const sizeLabel = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// "image/jpeg,image/png" ou "video/*" ou ".pdf" — o mesmo teste que o browser faz com o atributo accept.
function accepts(accept, file) {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  return accept.split(",").map(item => item.trim().toLowerCase()).some(rule => rule.startsWith(".") ? name.endsWith(rule)
    : rule.endsWith("/*") ? file.type.startsWith(rule.slice(0, -1)) : file.type === rule);
}

export function FilePicker({ file, onChange, accept = "", kind = "file", hint = "", maxBytes = 0, disabled = false, label, wide = false, required = false }) {
  const inputRef = useRef(null);
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const info = KINDS[kind] || KINDS.file;
  useEffect(() => {
    if (!file || !(file.type?.startsWith("image/") || file.type?.startsWith("video/"))) { setPreview(""); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const take = picked => {
    if (!picked) return;
    if (!accepts(accept, picked)) return setError(`Este tipo de ficheiro não serve aqui.${hint ? ` ${hint}` : ""}`);
    if (maxBytes && picked.size > maxBytes) return setError(`O ficheiro é demasiado grande (máximo ${sizeLabel(maxBytes)}).`);
    setError("");
    onChange(picked);
  };
  const drop = event => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) take(event.dataTransfer.files?.[0]);
  };
  const isVideo = file?.type?.startsWith("video/");

  return <div className={`tc-file${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}${wide ? " is-wide" : ""}${disabled ? " is-disabled" : ""}`}
    onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
    <input ref={inputRef} id={inputId} type="file" accept={accept} className="tc-file-input" disabled={disabled}
      required={required && !file} aria-label={label || info.title}
      onChange={event => { take(event.target.files?.[0]); event.target.value = ""; }} />
    {file ? <div className="tc-file-chosen">
      <span className={`tc-file-thumb${wide ? " is-wide" : ""}`}>
        {preview && !isVideo && <img src={preview} alt="" />}
        {preview && isVideo && <video src={preview} muted preload="metadata" />}
        {!preview && <Icon name={info.icon} size={20} />}
        {isVideo && <span className="tc-file-play" aria-hidden="true"><Icon name="play" size={14} /></span>}
      </span>
      <span className="tc-file-info"><strong title={file.name}>{file.name}</strong><small>{sizeLabel(file.size)}{file.type ? ` · ${file.type.split("/")[1].toUpperCase()}` : ""}</small></span>
      <span className="tc-file-actions">
        <button type="button" className="btn secondary" disabled={disabled} onClick={() => inputRef.current?.click()}>Trocar</button>
        <button type="button" className="btn secondary icon-only" disabled={disabled} aria-label={`Remover ${info.noun}`} title="Remover"
          onClick={() => { setError(""); onChange(null); }}><Icon name="trash" size={16} /></button>
      </span>
    </div> : <label className="tc-file-empty" htmlFor={inputId}>
      <span className="tc-file-icon"><Icon name={info.icon} size={20} /></span>
      <span className="tc-file-text"><strong>{info.title}</strong><small>ou arrasta para aqui{hint ? ` · ${hint}` : ""}</small></span>
      <span className="tc-file-cta" aria-hidden="true"><Icon name="plus" size={14} /> Escolher</span>
    </label>}
    {error && <p className="error tc-file-error" role="alert">{error}</p>}
  </div>;
}
