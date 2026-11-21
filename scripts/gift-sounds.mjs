// Gera os 8 sons de aviso dos presentes caros dos diretos (sintetizados aqui: sem direitos de autor).
// Cada nível é mais rico do que o anterior: mais notas, mais tempo, mais brilho.
//   1 Troféu (2 000 Kz) · 2 Coroa · 3 Diamante · 4 Carro · 5 Iate · 6 Avião · 7 Palácio · 8 Foguetão (25 000 Kz)
// Uso: node scripts/gift-sounds.mjs  → public/sounds/gift-N.wav e mobile/<app>/assets/sounds/gift-N.wav
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = ["tchilar-app"].map(name => path.join(root, "mobile", name)).find(dir => existsSync(dir));
const RATE = 22050;
const note = n => 440 * 2 ** ((n - 69) / 12); // número MIDI → Hz

function render(seconds, events) {
  const out = new Float32Array(Math.ceil(seconds * RATE));
  for (const { at, freq, dur, vol = 0.3, kind = "bell", to } of events) {
    const start = Math.floor(at * RATE);
    const length = Math.floor(dur * RATE);
    let phase = 0;
    for (let i = 0; i < length && start + i < out.length; i++) {
      const t = i / RATE;
      const f = to ? freq * (to / freq) ** (i / length) : freq;   // glissando
      phase += (2 * Math.PI * f) / RATE;
      const attack = Math.min(1, t / 0.008);
      let sample;
      if (kind === "bell") {       // sino: fundamental + parciais inarmónicas, decaimento longo
        sample = Math.sin(phase) + 0.45 * Math.sin(phase * 2.76) + 0.25 * Math.sin(phase * 5.4);
        sample *= Math.exp(-t * (3.2 / dur));
      } else if (kind === "brass") { // metais: harmónicos ímpares e pares, envelope sustentado
        sample = Math.sin(phase) + 0.6 * Math.sin(phase * 2) + 0.4 * Math.sin(phase * 3) + 0.25 * Math.sin(phase * 4) + 0.15 * Math.sin(phase * 5);
        sample *= Math.min(1, t / 0.03) * (t > dur - 0.12 ? Math.max(0, (dur - t) / 0.12) : 1) * 0.6;
      } else if (kind === "pad") {   // acorde de fundo suave
        sample = Math.sin(phase) + 0.3 * Math.sin(phase * 2);
        sample *= Math.sin(Math.PI * Math.min(1, t / dur)) * 0.7;
      } else if (kind === "whoosh") { // sopro a subir (ruído filtrado pela frequência)
        sample = (Math.random() * 2 - 1) * 0.5 + Math.sin(phase) * 0.5;
        sample *= Math.sin(Math.PI * (t / dur)) ** 2;
      } else {                       // "pluck": brilho curto
        sample = Math.sin(phase) + 0.3 * Math.sin(phase * 3);
        sample *= Math.exp(-t * 18);
      }
      out[start + i] += sample * vol * attack;
    }
  }
  // Eco curto (sala) e limite suave.
  for (const [delay, gain] of [[0.11, 0.28], [0.23, 0.16], [0.37, 0.08]]) {
    const d = Math.floor(delay * RATE);
    for (let i = out.length - 1; i >= d; i--) out[i] += out[i - d] * gain;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const scale = 0.85 / (peak || 1);
  const fadeOut = Math.floor(0.08 * RATE);
  return out.map((v, i) => Math.tanh(v * scale * 1.2) * (i > out.length - fadeOut ? (out.length - i) / fadeOut : 1));
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const arp = (notes, start, step, opts = {}) => notes.map((n, i) => ({ at: start + i * step, freq: note(n), dur: opts.dur || 0.6, vol: opts.vol || 0.3, kind: opts.kind || "bell" }));
const chord = (notes, at, dur, kind = "pad", vol = 0.18) => notes.map(n => ({ at, freq: note(n), dur, vol, kind }));
const sparkle = (start, count, step) => Array.from({ length: count }, (_, i) => ({ at: start + i * step, freq: note(96 + ((i * 5) % 12)), dur: 0.25, vol: 0.12, kind: "pluck" }));

const SOUNDS = {
  1: [0.8, [...arp([84, 91], 0, 0.12, { dur: 0.6 })]],
  2: [1.0, [...arp([84, 88, 91], 0, 0.11, { dur: 0.7 })]],
  3: [1.2, [...arp([88, 91, 96, 100, 103], 0, 0.07, { dur: 0.6, vol: 0.25 }), ...sparkle(0.35, 6, 0.08)]],
  4: [1.5, [...arp([67, 72, 76], 0, 0.14, { kind: "brass", dur: 0.22, vol: 0.28 }), ...chord([67, 72, 76, 79], 0.45, 0.9, "brass", 0.14), ...arp([96], 0.5, 0, { dur: 0.8, vol: 0.2 })]],
  5: [1.8, [...arp([72, 76, 79, 84, 88, 91, 96], 0, 0.07, { dur: 0.5, vol: 0.22 }), ...chord([60, 72, 76, 79], 0.5, 1.2), ...arp([96, 100], 0.6, 0.15, { dur: 0.9, vol: 0.18 })]],
  6: [2.1, [{ at: 0, freq: 300, to: 1600, dur: 0.6, vol: 0.18, kind: "whoosh" }, ...arp([72, 76, 79], 0.5, 0.12, { kind: "brass", dur: 0.25, vol: 0.26 }),
    ...chord([60, 67, 72, 76, 79], 0.9, 1.1, "brass", 0.12), ...sparkle(1.0, 8, 0.07)]],
  7: [2.5, [...arp([67, 67, 72, 76], 0, 0.15, { kind: "brass", dur: 0.2, vol: 0.28 }), ...arp([79], 0.62, 0, { kind: "brass", dur: 0.5, vol: 0.3 }),
    ...chord([48, 60, 64, 67, 72], 1.0, 1.4, "pad", 0.2), ...chord([72, 76, 79, 84], 1.0, 1.3, "brass", 0.1), ...arp([96, 100, 103, 108], 1.1, 0.12, { dur: 0.9, vol: 0.16 })]],
  8: [3.2, [{ at: 0, freq: 120, to: 2400, dur: 1.1, vol: 0.22, kind: "whoosh" }, ...arp([60, 64, 67, 72, 76, 79, 84], 0.55, 0.06, { kind: "pluck", vol: 0.22 }),
    ...arp([72, 76, 79, 84], 1.0, 0.1, { kind: "brass", dur: 0.25, vol: 0.28 }), ...chord([36, 48, 60, 64, 67, 72], 1.45, 1.6, "pad", 0.22),
    ...chord([72, 76, 79, 84, 88], 1.45, 1.5, "brass", 0.1), ...sparkle(1.5, 16, 0.08), ...arp([96, 103, 108], 1.6, 0.25, { dur: 1.0, vol: 0.16 })]]
};

const targets = [path.join(root, "public", "sounds"), ...(appDir ? [path.join(appDir, "assets", "sounds")] : [])];
for (const dir of targets) mkdirSync(dir, { recursive: true });
for (const [level, [seconds, events]] of Object.entries(SOUNDS)) {
  const file = wav(render(seconds, events));
  for (const dir of targets) writeFileSync(path.join(dir, `gift-${level}.wav`), file);
}
console.log(`8 sons gerados em ${targets.map(dir => path.relative(root, dir)).join(" e ")}.`);
