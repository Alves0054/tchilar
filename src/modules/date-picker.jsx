// Calendário do Tchilar: substitui o <input type="date"> e o <input type="datetime-local"> do browser.
// Usa-se como esses campos: value "AAAA-MM-DD" (mode="date") ou "AAAA-MM-DDTHH:MM" (mode="datetime"),
// e onChange recebe event.target.value no mesmo formato ("" quando se limpa).
// O mês abre num portal por cima de tudo; tem atalhos (Hoje, Amanhã, Sábado), mês e ano em caixas nossas
// (útil para a data de nascimento) e, com hora, a hora e os minutos.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./core.jsx";
import { Select } from "./select.jsx";
import "./date-picker.css";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEKDAYS = [["S", "segunda"], ["T", "terça"], ["Q", "quarta"], ["Q", "quinta"], ["S", "sexta"], ["S", "sábado"], ["D", "domingo"]];
const pad = number => String(number).padStart(2, "0");
const dayKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDay = text => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text || "");
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
};
const timeOf = text => (/T(\d{2}:\d{2})/.exec(text || "") || [])[1] || "";

export function formatPickerValue(value, mode = "datetime") {
  const day = parseDay(value);
  if (!day) return "";
  const date = day.toLocaleDateString("pt-PT", mode === "date"
    ? { day: "numeric", month: "long", year: "numeric" }
    : { weekday: "long", day: "numeric", month: "long", year: day.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  const time = timeOf(value);
  const text = mode === "datetime" && time ? `${date} · ${time}` : date;
  return text[0].toUpperCase() + text.slice(1);
}

export function DatePicker({
  value = "", onChange, mode = "datetime", min = "", max = "", required = false, disabled = false, id,
  placeholder, defaultTime = "18:00", shortcuts = mode === "datetime", "aria-label": ariaLabel, className = ""
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const selectedDay = parseDay(value);
  const minDay = parseDay(min);
  const maxDay = parseDay(max);
  // Mês que abre: o escolhido; senão hoje, a não ser que hoje esteja fora dos limites (então o limite mais próximo).
  const startView = () => {
    if (selectedDay) return selectedDay;
    const today = new Date();
    if (minDay && minDay > today) return minDay;
    if (maxDay && maxDay < today) return maxDay;
    return today;
  };
  const [view, setView] = useState(startView);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const dialogId = useId();

  const emit = next => onChange?.({ target: { value: next }, currentTarget: { value: next } });

  const measure = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Altura real do calendário (ou uma estimativa antes de abrir). Por baixo se couber; senão por cima;
    // se não couber em nenhum lado, encosta-se ao ecrã para o "Feito" estar sempre à vista.
    const height = Math.min(panelRef.current?.offsetHeight || (mode === "datetime" ? 490 : 420), window.innerHeight - 16);
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const up = below < height && above >= height;
    const top = up ? rect.top - 6 - height : Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8));
    const width = Math.min(window.innerWidth - 16, 320);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setPlace({ left, width, up, top, maxHeight: window.innerHeight - 16 });
  }, [mode]);

  const close = useCallback((focus = true) => {
    setOpen(false);
    if (focus) triggerRef.current?.focus();
  }, []);

  const openPanel = () => {
    if (disabled) return;
    setView(startView());
    measure();
    setOpen(true);
  };

  useEffect(() => { if (open) measure(); }, [open, measure]);

  // Fecha ao clicar fora (as listas das caixas de mês/ano/hora contam como dentro).
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = event => {
      if (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target) || event.target.closest?.(".tc-select-panel")) return;
      close(false);
    };
    const onKey = event => { if (event.key === "Escape" && !document.querySelector(".tc-select-panel")) { event.stopPropagation(); close(); } };
    const onScroll = event => { if (!panelRef.current?.contains(event.target)) measure(); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer, { passive: true });
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, close, measure]);

  // Junta o dia e a hora; se ficar antes do mínimo, passa para a primeira hora permitida (de 15 em 15 minutos).
  const compose = (day, time) => {
    if (mode === "date") return dayKey(day);
    let next = `${dayKey(day)}T${time || timeOf(value) || defaultTime}`;
    if (min && next < min.slice(0, 16)) {
      const [hours, minutes] = timeOf(min).split(":").map(Number);
      const rounded = Math.ceil((hours * 60 + minutes) / 15) * 15;
      next = rounded >= 24 * 60 ? next : `${dayKey(day)}T${pad(Math.floor(rounded / 60))}:${pad(rounded % 60)}`;
    }
    return next;
  };
  const pickDay = day => {
    emit(compose(day));
    if (mode === "date") close();
  };
  const isOff = day => (minDay && day < minDay) || (maxDay && day > maxDay);

  // Grelha do mês (começa à segunda-feira).
  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => new Date(view.getFullYear(), view.getMonth(), index - offset + 1));
  }, [view]);
  const todayKey = dayKey(new Date());
  const shiftMonth = step => setView(current => new Date(current.getFullYear(), current.getMonth() + step, 1));

  // Anos para a caixa: à volta do valor, ou desde 100 anos atrás (datas de nascimento) até 5 anos à frente.
  const thisYear = new Date().getFullYear();
  const fromYear = minDay ? minDay.getFullYear() : thisYear - 100;
  const toYear = maxDay ? maxDay.getFullYear() : thisYear + 5;
  const years = [];
  for (let year = toYear; year >= fromYear; year -= 1) years.push(year);

  const quick = (() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const saturday = new Date(today); saturday.setDate(today.getDate() + ((6 - today.getDay() + 7) % 7 || 7));
    return [["Hoje", today], ["Amanhã", tomorrow], ["Sábado", saturday]].filter(([, day]) => !isOff(day));
  })();

  const [hours, minutes] = (timeOf(value) || defaultTime).split(":");
  const minuteOptions = ["00", "15", "30", "45"].includes(minutes) ? ["00", "15", "30", "45"] : ["00", "15", "30", "45", minutes].sort();
  const setTime = (nextHours, nextMinutes) => selectedDay && emit(compose(selectedDay, `${nextHours}:${nextMinutes}`));

  const shown = formatPickerValue(value, mode);
  return <span className={`tc-date${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}>
    <button ref={triggerRef} id={id} type="button" className="tc-select-trigger tc-date-trigger" disabled={disabled}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined} aria-label={ariaLabel ? `${ariaLabel}${shown ? `: ${shown}` : ""}` : undefined}
      onClick={() => (open ? close() : openPanel())}
      onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); openPanel(); } }}>
      <Icon name="events" size={16} />
      <span className={`tc-select-value${shown ? "" : " is-placeholder"}`}>{shown || placeholder || (mode === "datetime" ? "Escolhe o dia e a hora" : "Escolhe o dia")}</span>
      <Icon name="chevronDown" size={16} />
    </button>
    {required && <input className="tc-select-proxy" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => {}}
      onFocus={() => triggerRef.current?.focus()} />}
    {open && place && createPortal(<div ref={panelRef} id={dialogId} role="dialog" aria-label={ariaLabel || "Calendário"}
      className={`tc-date-panel${place.up ? " is-up" : ""}`} style={{ left: place.left, width: place.width, top: place.top, maxHeight: place.maxHeight }}>
      {shortcuts && quick.length > 0 && <div className="tc-date-quick">
        {quick.map(([label, day]) => <button key={label} type="button" className={selectedDay && dayKey(selectedDay) === dayKey(day) ? "is-on" : ""}
          onClick={() => { setView(day); pickDay(day); }}>{label}</button>)}
      </div>}
      <div className="tc-date-head">
        <button type="button" className="tc-date-nav" aria-label="Mês anterior" onClick={() => shiftMonth(-1)}><Icon name="previous" size={16} /></button>
        <Select aria-label="Mês" value={String(view.getMonth())} onChange={event => setView(new Date(view.getFullYear(), Number(event.target.value), 1))}>
          {MONTHS.map((name, index) => <option key={name} value={String(index)}>{name[0].toUpperCase() + name.slice(1)}</option>)}
        </Select>
        <Select aria-label="Ano" value={String(view.getFullYear())} onChange={event => setView(new Date(Number(event.target.value), view.getMonth(), 1))}>
          {years.map(year => <option key={year} value={String(year)}>{year}</option>)}
        </Select>
        <button type="button" className="tc-date-nav" aria-label="Mês seguinte" onClick={() => shiftMonth(1)}><Icon name="next" size={16} /></button>
      </div>
      <div className="tc-date-grid" role="grid" aria-label={`${MONTHS[view.getMonth()]} de ${view.getFullYear()}`}>
        {WEEKDAYS.map(([short, name], index) => <span key={name} className={`tc-date-weekday${index >= 5 ? " is-weekend" : ""}`} aria-label={name}>{short}</span>)}
        {cells.map(day => {
          const key = dayKey(day);
          const outside = day.getMonth() !== view.getMonth();
          const chosen = selectedDay && key === dayKey(selectedDay);
          return <button key={key} type="button" role="gridcell" disabled={isOff(day)} aria-selected={Boolean(chosen)}
            aria-label={day.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            className={`tc-date-day${outside ? " is-outside" : ""}${chosen ? " is-selected" : ""}${key === todayKey ? " is-today" : ""}`}
            onClick={() => pickDay(day)}>{day.getDate()}</button>;
        })}
      </div>
      {mode === "datetime" && <div className="tc-date-time">
        <span className="tc-date-time-label"><Icon name="clock" size={15} /> Hora</span>
        <Select aria-label="Horas" value={hours} disabled={!selectedDay} onChange={event => setTime(event.target.value, minutes)}>
          {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={pad(hour)}>{pad(hour)}</option>)}
        </Select>
        <span className="tc-date-colon">:</span>
        <Select aria-label="Minutos" value={minutes} disabled={!selectedDay} onChange={event => setTime(hours, event.target.value)}>
          {minuteOptions.map(minute => <option key={minute} value={minute}>{minute}</option>)}
        </Select>
      </div>}
      <div className="tc-date-foot">
        {!required && value ? <button type="button" className="text-button" onClick={() => { emit(""); close(); }}>Limpar</button> : <span />}
        <button type="button" className="btn" onClick={() => close()}>{mode === "datetime" && !selectedDay ? "Fechar" : "Feito"}</button>
      </div>
    </div>, document.body)}
  </span>;
}
