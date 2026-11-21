// Caixa de seleção do Tchilar: substitui o <select> nativo do browser em todo o site.
// Usa-se como um <select> (com <option> e <optgroup> lá dentro) e o onChange recebe event.target.value,
// por isso trocar <select> por <Select> não obriga a mudar mais nada.
//
// A lista abre num portal por cima de tudo (não fica cortada por janelas ou cartões) e vira para cima quando não
// há espaço por baixo. Teclado: setas, Home/End, Enter/Espaço, Esc e saltar pela primeira letra.
// "required" continua a funcionar: um campo escondido faz o browser bloquear o envio do formulário se estiver vazio.
import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./core.jsx";
import "./select.css";

// Texto de um <option> (pode vir em pedaços: {label}{" (sem SMTP)"}).
function textOf(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf(node.props.children);
  return "";
}

// Lê os <option>/<optgroup> (também dentro de fragmentos e listas) para uma lista simples.
function readOptions(children, group = null, out = []) {
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) { readOptions(child.props.children, group, out); return; }
    if (child.type === "optgroup") {
      out.push({ header: child.props.label, key: `group-${child.props.label}` });
      readOptions(child.props.children, child.props.label, out);
      return;
    }
    if (child.type === "option") {
      const label = textOf(child.props.children);
      const value = child.props.value === undefined ? label : String(child.props.value);
      out.push({ value, label, disabled: Boolean(child.props.disabled), group, key: `${group || ""}:${value}` });
    }
  });
  return out;
}

const PANEL_MAX = 320;

export function Select({
  value, defaultValue, onChange, children, disabled = false, required = false, name, id,
  className = "", placeholder = "Escolhe", renderValue, minPanelWidth = 200, "aria-label": ariaLabel, "aria-describedby": describedBy
}) {
  const options = useMemo(() => readOptions(children), [children]);
  const choices = options.filter(option => !option.header);
  const [inner, setInner] = useState(defaultValue ?? choices[0]?.value ?? "");
  const current = value === undefined ? inner : String(value ?? "");
  const selected = choices.find(option => option.value === current);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();

  const enabledIndexes = options.map((option, index) => (!option.header && !option.disabled ? index : -1)).filter(index => index >= 0);

  // Posição da lista junto da caixa (fixa no ecrã); vira para cima se não couber por baixo.
  const measure = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < Math.min(PANEL_MAX, 220) && above > below;
    const width = Math.min(window.innerWidth - 16, Math.max(rect.width, minPanelWidth));
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setPlace({ left, width, up, top: up ? undefined : rect.bottom + 6, bottom: up ? window.innerHeight - rect.top + 6 : undefined,
      maxHeight: Math.max(160, Math.min(PANEL_MAX, up ? above : below)) });
  }, [minPanelWidth]);

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const openList = () => {
    if (disabled) return;
    measure();
    const index = options.findIndex(option => !option.header && option.value === current && !option.disabled);
    setActive(index >= 0 ? index : enabledIndexes[0] ?? -1);
    setOpen(true);
  };

  const choose = option => {
    if (!option || option.header || option.disabled) return;
    if (value === undefined) setInner(option.value);
    if (option.value !== current) onChange?.({ target: { value: option.value, name }, currentTarget: { value: option.value, name } });
    close();
  };

  // Fecha ao clicar fora, ao mudar o tamanho da janela; acompanha a caixa se a página andar.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = event => {
      if (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
      close(false);
    };
    const onScroll = event => { if (!panelRef.current?.contains(event.target)) measure(); };
    const onResize = () => close(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer, { passive: true });
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close, measure]);

  // Mantém a opção ativa à vista quando se anda com as setas.
  useLayoutEffect(() => {
    if (!open || active < 0) return;
    panelRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const move = step => {
    if (!enabledIndexes.length) return;
    const position = enabledIndexes.indexOf(active);
    const next = position < 0 ? (step > 0 ? 0 : enabledIndexes.length - 1) : Math.min(enabledIndexes.length - 1, Math.max(0, position + step));
    setActive(enabledIndexes[next]);
  };

  // Saltar para a opção que começa pelas letras escritas (como no <select>).
  const typeahead = key => {
    const now = Date.now();
    typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + key.toLowerCase(), at: now };
    const normalize = text => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const found = enabledIndexes.find(index => normalize(options[index].label).startsWith(normalize(typed.current.text)));
    if (found === undefined) return;
    if (open) setActive(found);
    else choose(options[found]);
  };

  const onKeyDown = event => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openList(); else move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      if (!open) return;
      event.preventDefault();
      setActive(event.key === "Home" ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) openList(); else choose(options[active]);
    } else if (event.key === "Escape") {
      if (open) { event.preventDefault(); event.stopPropagation(); close(); }
    } else if (event.key === "Tab") {
      if (open) close(false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typeahead(event.key);
    }
  };

  const shown = renderValue ? renderValue(selected) : selected?.label;
  const isPlaceholder = !selected || (selected.disabled && selected.value === "");

  return <span className={`tc-select${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}>
    <button ref={triggerRef} id={id} type="button" className="tc-select-trigger" disabled={disabled}
      role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-label={ariaLabel} aria-describedby={describedBy} aria-required={required || undefined}
      aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      onClick={() => (open ? close() : openList())} onKeyDown={onKeyDown}>
      <span className={`tc-select-value${isPlaceholder ? " is-placeholder" : ""}`}>{shown || placeholder}</span>
      <Icon name="chevronDown" size={16} />
    </button>
    {/* Para o browser validar "required" e para formulários com name, como o <select> fazia. */}
    {(required || name) && <input className="tc-select-proxy" tabIndex={-1} aria-hidden="true" name={name} required={required}
      value={isPlaceholder && required ? "" : current} onChange={() => {}} onFocus={() => triggerRef.current?.focus()} />}
    {open && place && createPortal(<div ref={panelRef} id={listId} role="listbox" className={`tc-select-panel${place.up ? " is-up" : ""}`}
      aria-label={ariaLabel} style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}
      onMouseDown={event => event.preventDefault()}>
      {options.map((option, index) => option.header
        ? <div key={option.key} className="tc-select-group" role="presentation">{option.header}</div>
        : <div key={option.key} id={`${listId}-${index}`} data-index={index} role="option" aria-selected={option.value === current}
          aria-disabled={option.disabled || undefined}
          className={`tc-select-option${option.value === current ? " is-selected" : ""}${index === active ? " is-active" : ""}${option.disabled ? " is-disabled" : ""}${option.group ? " is-grouped" : ""}`}
          onMouseEnter={() => !option.disabled && setActive(index)} onClick={() => choose(option)}>
          <span>{option.label}</span>
          {option.value === current && <Icon name="check" size={16} />}
        </div>)}
    </div>, document.body)}
  </span>;
}
