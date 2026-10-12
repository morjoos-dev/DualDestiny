// Música original de Dual Destiny, sintetizada (estilo JRPG de 16 bits / anime de los 90). Temas en bucle perfecto:
// se renderiza el bucle + la cola de reverberación y la cola se suma al principio (empalma sin corte).
// Salida: <carpeta>/<tema>.wav (44,1 kHz estéreo) + .ogg (Unity) + .mp3 (escuchar en el móvil), con ffmpeg.
// Uso: node music_gen.js <carpeta de salida> [tema ...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const [, , outRoot, ...only] = process.argv;
const SR = 44100;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

// ── Síntesis básica (mono) ─────────────────────────────────────────────────
let seed = 1; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const N = s => Math.max(1, Math.round(s * SR));
const midi = n => 440 * Math.pow(2, (n - 69) / 12);
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/// "F#4" → MIDI
const nm = s => { const m = /^([A-G])([#b]?)(-?\d)$/.exec(s); if (!m) throw new Error('nota ' + s); return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
/// Melodía "A4:1 C5:0.5 r:0.5 ..." → [{n|null, b(eats)}]
const mel = s => s.trim().split(/\s+/).map(t => { const [a, d] = t.split(':'); return { n: a === 'r' ? null : nm(a), b: +d }; });

function osc(dur, f, o = {}) {
  const b = new Float32Array(N(dur)), { wave = 'square', duty = 0.5, vib = 0, vibRate = 5.5, vibDelay = 0.15, glideFrom = 0, glide = 0.04 } = o;
  let ph = rnd();
  for (let i = 0; i < b.length; i++) {
    const t = i / SR; let fr = f;
    if (glideFrom && t < glide) fr = glideFrom + (f - glideFrom) * (t / glide);
    if (vib && t > vibDelay) fr *= 1 + vib * Math.min(1, (t - vibDelay) / 0.2) * Math.sin(2 * Math.PI * vibRate * t);
    ph = (ph + fr / SR) % 1;
    b[i] = wave === 'sine' ? Math.sin(2 * Math.PI * ph) : wave === 'tri' ? 4 * Math.abs(ph - 0.5) - 1 : wave === 'saw' ? 2 * ph - 1 : (ph < duty ? 1 : -1);
  }
  return b;
}
function env(b, a, d, s, r, holdSec) {   // ADSR: holdSec = tiempo hasta soltar (después, release)
  for (let i = 0; i < b.length; i++) { const t = i / SR; let e;
    if (t < a) e = t / a; else if (t < a + d) e = 1 - (1 - s) * (t - a) / d; else if (t < holdSec) e = s; else e = s * Math.max(0, 1 - (t - holdSec) / r);
    b[i] *= e; }
  return b;
}
function lp(b, fc, q = 0.7) { const out = new Float32Array(b.length); let low = 0, band = 0; const damp = 1 / q;
  for (let i = 0; i < b.length; i++) { const c = typeof fc === 'function' ? fc(i / SR) : fc; const f = 2 * Math.sin(Math.PI * Math.min(c, SR / 6) / SR);
    low += f * band; const high = b[i] - low - damp * band; band += f * high; out[i] = low; } return out; }
function hp(b, fc) { const out = new Float32Array(b.length); let low = 0, band = 0; const f = 2 * Math.sin(Math.PI * fc / SR);
  for (let i = 0; i < b.length; i++) { low += f * band; const high = b[i] - low - 1.4 * band; band += f * high; out[i] = high; } return out; }
function bp(b, fc, q = 1.5) { const out = new Float32Array(b.length); let low = 0, band = 0; const f = 2 * Math.sin(Math.PI * fc / SR);
  for (let i = 0; i < b.length; i++) { low += f * band; const high = b[i] - low - band / q; band += f * high; out[i] = band; } return out; }
function noise(dur, color = 'white') { const b = new Float32Array(N(dur)); let br = 0;
  for (let i = 0; i < b.length; i++) { const w = rnd() * 2 - 1; if (color === 'brown') { br = (br + 0.02 * w) / 1.02; b[i] = br * 3.5; } else b[i] = w; } return b; }
const tanhDist = (b, k) => { const n = Math.tanh(k); for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * k) / n; return b; };
function add(a, b, g = 1) { for (let i = 0; i < b.length && i < a.length; i++) a[i] += b[i] * g; return a; }

// ── Instrumentos (devuelven mono; dur = segundos que suena la nota) ─────────
const INST = {
  // melodía: flauta suave (triángulo + un poco de seno a la octava, vibrato que entra tarde)
  flauta: (f, dur) => { const b = add(osc(dur + 0.25, f, { wave: 'tri', vib: 0.008, vibDelay: 0.25 }), osc(dur + 0.25, f * 2, { wave: 'sine', vib: 0.008, vibDelay: 0.25 }), 0.18);
    return lp(env(b, 0.04, 0.1, 0.8, 0.25, dur), 3200); },
  // melodía de combate: cuadrada con vibrato (líder de 16 bits)
  lider: (f, dur, o = {}) => lp(env(add(osc(dur + 0.12, f, { wave: 'square', duty: 0.25, vib: 0.012, vibDelay: 0.12, vibRate: 6, glideFrom: o.from, glide: 0.035 }),
    osc(dur + 0.12, f * 1.003, { wave: 'square', duty: 0.5 }), 0.35), 0.006, 0.08, 0.75, 0.12, dur), 5200),
  // arpa / cuerda pulsada (Karplus-Strong)
  arpa: (f, dur) => { const len = Math.max(dur, 1.2), b = new Float32Array(N(len)), L = Math.max(2, Math.round(SR / f)), ring = new Float32Array(L);
    for (let i = 0; i < L; i++) ring[i] = rnd() * 2 - 1; let idx = 0;
    for (let i = 0; i < b.length; i++) { const a = ring[idx], c = ring[(idx + 1) % L]; ring[idx] = (a * 0.45 + c * 0.55) * 0.9985; b[i] = a; idx = (idx + 1) % L; }
    return lp(env(b, 0.002, 0.05, 0.9, 0.4, len - 0.4), 4200); },
  // cuerdas / colchón: 3 sierras desafinadas por un paso bajo, ataque lento
  cuerdas: (f, dur) => { const b = new Float32Array(N(dur + 0.6)); for (const det of [-0.006, 0, 0.007]) add(b, osc(dur + 0.6, f * (1 + det), { wave: 'saw', vib: 0.003, vibRate: 4.5, vibDelay: 0 }), 0.33);
    return lp(env(b, 0.35, 0.3, 0.8, 0.6, dur), 1800); },
  coro: (f, dur) => { const b = new Float32Array(N(dur + 0.8)); for (const det of [-0.004, 0.004]) add(b, osc(dur + 0.8, f * (1 + det), { wave: 'tri', vib: 0.004, vibRate: 5, vibDelay: 0 }), 0.5);
    const v = add(bp(b, 700, 2), bp(b, 1100, 2), 0.7); return env(v, 0.6, 0.3, 0.85, 0.8, dur); },
  bajo: (f, dur) => lp(env(add(osc(dur + 0.05, f, { wave: 'tri' }), osc(dur + 0.05, f, { wave: 'square', duty: 0.5 }), 0.25), 0.005, 0.08, 0.8, 0.05, dur), 900),
  // bajo de combate: sierra con filtro que se cierra (ataque "slap")
  bajoRock: (f, dur) => { const b = osc(dur + 0.03, f, { wave: 'saw' }); return env(lp(b, t => 300 + 2200 * Math.exp(-t * 18), 1.2), 0.003, 0.05, 0.7, 0.03, dur); },
  // guitarra eléctrica (quinta saturada); corta = sordina
  guitarra: (f, dur, o = {}) => { const b = new Float32Array(N(dur + 0.05));
    for (const [m, g] of [[1, 1], [1.4983, 0.8], [2, 0.5]]) for (const det of [-0.003, 0.003]) add(b, osc(dur + 0.05, f * m * (1 + det), { wave: 'saw' }), g * 0.4);
    const d = tanhDist(b, 3.5); return env(lp(d, o.mute ? 1300 : 2600), 0.003, 0.06, o.mute ? 0.4 : 0.85, 0.05, dur); },
  // metales: sierra con filtro que se abre al atacar
  metales: (f, dur) => { const b = new Float32Array(N(dur + 0.15)); for (const det of [-0.004, 0.004]) add(b, osc(dur + 0.15, f * (1 + det), { wave: 'saw', vib: 0.005, vibDelay: 0.2 }), 0.5);
    return env(lp(b, t => 600 + 2800 * Math.min(1, t / 0.06) * Math.exp(-t * 2.5) + 900), 0.02, 0.15, 0.7, 0.15, dur); },
  campana: (f, dur) => { const len = Math.max(dur, 2.5), b = new Float32Array(N(len));
    for (let i = 0; i < b.length; i++) { const t = i / SR, e = Math.exp(-t * 1.6), m = Math.sin(2 * Math.PI * f * 3.5 * t) * 2.2 * Math.exp(-t * 3); b[i] = Math.sin(2 * Math.PI * f * t + m) * e; }
    return b; },
  // percusión
  bombo: () => { const b = new Float32Array(N(0.35)); let ph = 0; for (let i = 0; i < b.length; i++) { const t = i / SR, f = 45 + 110 * Math.exp(-t * 28); ph += f / SR; b[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 9); }
    return add(b, lp(env(noise(0.01), 0.0005, 0.005, 0, 0.004, 0.005), 3000), 0.5); },
  caja: () => { const n = env(bp(noise(0.25), 1900, 0.8), 0.001, 0.04, 0.3, 0.12, 0.05); const t = env(osc(0.12, 185, { wave: 'tri' }), 0.001, 0.05, 0.2, 0.05, 0.05); return add(n, t, 0.6); },
  charles: (o = {}) => env(hp(noise(o.open ? 0.3 : 0.06), 7000), 0.001, o.open ? 0.12 : 0.03, 0.05, o.open ? 0.15 : 0.02, 0.01),
  platillo: () => env(hp(noise(1.6), 5000), 0.002, 0.3, 0.35, 1.2, 0.3),
  tambor: (f = 70) => { const b = new Float32Array(N(0.9)); let ph = 0; for (let i = 0; i < b.length; i++) { const t = i / SR; ph += (f + 40 * Math.exp(-t * 12)) / SR; b[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 4.5); }
    return add(b, lp(env(noise(0.15, 'brown'), 0.001, 0.05, 0.3, 0.08, 0.05), 400), 0.8); },
  maraca: () => env(hp(noise(0.05), 6000), 0.004, 0.02, 0.2, 0.02, 0.02),
};

// ── Mezcla estéreo ─────────────────────────────────────────────────────────
class Song {
  constructor(bpm, bars, beatsPerBar = 4) { this.bpm = bpm; this.beat = 60 / bpm; this.bars = bars; this.bpb = beatsPerBar;
    this.len = bars * beatsPerBar * this.beat; this.tail = 3; this.L = new Float32Array(N(this.len + this.tail)); this.R = new Float32Array(this.L.length);
    this.wetL = new Float32Array(this.L.length); this.wetR = new Float32Array(this.L.length); }
  at(bar, beat = 0) { return (bar * this.bpb + beat) * this.beat; }
  put(b, t, { gain = 1, pan = 0, wet = 0.25 } = {}) {
    const o = N(t), gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
    for (let i = 0; i < b.length; i++) { const j = o + i; if (j >= this.L.length) break;
      this.L[j] += b[i] * gl; this.R[j] += b[i] * gr; this.wetL[j] += b[i] * gl * wet; this.wetR[j] += b[i] * gr * wet; } }
  /// Melodía desde la barra startBar con un instrumento; legato = fracción del valor que suena
  melody(inst, startBar, notes, o = {}) { let beat = 0, prev = null; const { legato = 0.95, transpose = 0 } = o;
    for (const { n, b } of notes) { if (n !== null) { const f = midi(n + transpose);
        this.put(INST[inst](f, b * this.beat * legato, { from: o.glide && prev ? midi(prev + transpose) : 0 }), this.at(startBar, beat), o); prev = n; }
      beat += b; } return beat; }
  render(reverbSize = 1, master = 0.15) {   // master = volumen percibido (RMS) del tema
    const wl = reverb(this.wetL, reverbSize), wr = reverb(this.wetR, reverbSize * 1.07);
    for (let i = 0; i < this.L.length; i++) { this.L[i] += wl[i]; this.R[i] += wr[i]; }
    // bucle perfecto: lo que suena después del final (colas) entra al principio; sin bucle (noLoop), la cola queda al final
    const n = this.noLoop ? this.L.length : N(this.len), L = this.L.slice(0, n), R = this.R.slice(0, n);
    if (!this.noLoop) for (let i = n; i < this.L.length; i++) { L[i - n] += this.L[i]; R[i - n] += this.R[i]; }
    // volumen percibido del tema (RMS) y limitador suave solo por encima de 0,7 (no aplasta la dinámica)
    let ss = 0; for (let i = 0; i < n; i++) ss += L[i] * L[i] + R[i] * R[i];
    const g = master / (Math.sqrt(ss / (2 * n)) || 1);
    const lim = x => { const a = Math.abs(x); return a <= 0.7 ? x : Math.sign(x) * (0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28)); };
    for (let i = 0; i < n; i++) { L[i] = lim(L[i] * g); R[i] = lim(R[i] * g); }
    return [L, R];
  }
}
function reverb(b, size) {   // Schroeder (solo la parte húmeda)
  const out = new Float32Array(b.length);
  const combs = [1557, 1617, 1491, 1422, 1277, 1356].map(n => ({ d: Math.round(n * size), buf: new Float32Array(Math.round(n * size)), i: 0 }));
  const aps = [225, 556, 441].map(n => ({ d: n, buf: new Float32Array(n), i: 0 }));
  for (let i = 0; i < b.length; i++) { const x = b[i]; let s = 0;
    for (const c of combs) { const y = c.buf[c.i]; c.buf[c.i] = x + y * 0.8; c.i = (c.i + 1) % c.d; s += y; } s /= 6;
    for (const a of aps) { const y = a.buf[a.i]; const v = -s * 0.5 + y; a.buf[a.i] = s + y * 0.5; a.i = (a.i + 1) % a.d; s = v; }
    out[i] = s; }
  return lp(out, 6000);
}
// Acordes: nombre → notas (MIDI) en una octava
const CH = { maj: [0, 4, 7], min: [0, 3, 7], dom7: [0, 4, 7, 10], min7: [0, 3, 7, 10], sus4: [0, 5, 7] };
const chord = (root, kind = 'maj') => CH[kind].map(x => nm(root) + x);

// ── TEMAS ──────────────────────────────────────────────────────────────────
const SONGS = {};

// 1) Pueblo — Fa mayor, 92 ppm: arpa, flauta, cuerdas, bajo suave y maraca
SONGS.pueblo = () => {
  const s = new Song(92, 24);
  const A = [['F3', 'maj'], ['C3', 'maj'], ['D3', 'min'], ['A#2', 'maj'], ['F3', 'maj'], ['C3', 'maj'], ['A#2', 'maj'], ['C3', 'maj']];
  const B = [['G3', 'min'], ['C3', 'maj'], ['F3', 'maj'], ['D3', 'min'], ['A#2', 'maj'], ['C3', 'maj'], ['F3', 'maj'], ['C3', 'maj']];
  const prog = [...A, ...B, ...A];
  prog.forEach(([r, k], bar) => {
    const c = chord(r, k);
    s.put(INST.cuerdas(midi(c[0] + 12), s.beat * 4), s.at(bar), { gain: 0.10, pan: -0.3, wet: 0.5 });
    s.put(INST.cuerdas(midi(c[1] + 12), s.beat * 4), s.at(bar), { gain: 0.08, pan: 0.3, wet: 0.5 });
    s.put(INST.bajo(midi(c[0] - 12), s.beat * 1.8), s.at(bar, 0), { gain: 0.42, wet: 0.08 });
    s.put(INST.bajo(midi(c[2] - 12), s.beat * 1.8), s.at(bar, 2), { gain: 0.34, wet: 0.08 });
    const arp = [c[0], c[2], c[0] + 12, c[1] + 12, c[2] + 12, c[1] + 12, c[0] + 12, c[2]];
    arp.forEach((n, k) => s.put(INST.arpa(midi(n + 12), s.beat * 0.5), s.at(bar, k * 0.5), { gain: 0.16, pan: 0.35 * Math.sin(k), wet: 0.35 }));
    for (let k = 0; k < 8; k++) s.put(INST.maraca(), s.at(bar, k * 0.5), { gain: k % 2 ? 0.05 : 0.08, pan: 0.5, wet: 0.1 });
  });
  const melA = mel(`A4:1 C5:1 F5:1.5 E5:0.5  D5:1 C5:1 G4:2  A4:1 D5:1 F5:1 E5:0.5 D5:0.5  C5:1.5 A#4:0.5 A4:1 G4:1
    A4:1 C5:1 F5:1 G5:0.5 A5:0.5  G5:1.5 F5:0.5 E5:1 C5:1  D5:1 A#4:1 C5:1 D5:1  E5:1 G5:1 C5:2`);
  const melB = mel(`A#4:1 D5:1 G5:2  F5:1 E5:1 C5:2  A4:1 C5:1 F5:1 A5:1  G5:1.5 F5:0.5 D5:2
    D5:1 F5:1 A#5:1.5 A5:0.5  G5:1 E5:1 C5:1 D5:0.5 E5:0.5  F5:1.5 E5:0.5 D5:1 C5:1  E5:1 D5:1 C5:2`);
  s.melody('flauta', 0, melA, { gain: 0.34, pan: 0.05, wet: 0.35, legato: 0.92 });
  s.melody('flauta', 8, melB, { gain: 0.34, pan: 0.05, wet: 0.35, legato: 0.92 });
  s.melody('flauta', 16, melA, { gain: 0.3, pan: -0.1, wet: 0.35, legato: 0.92 });
  s.melody('campana', 16, melA.map(x => ({ ...x, n: x.n && x.b >= 1 ? x.n + 12 : null })), { gain: 0.06, pan: 0.4, wet: 0.5 });   // eco de campanas en la vuelta
  return s.render(1.1, 0.12);   // tranquilo
};

// 2) Combate — Re menor, 152 ppm: batería, bajo galopante, guitarra, metales y líder de 16 bits
SONGS.combate = () => {
  const s = new Song(152, 32);
  const A = [['D3', 'min'], ['A#2', 'maj'], ['C3', 'maj'], ['A2', 'maj']];
  const B = [['G2', 'min'], ['A2', 'maj'], ['D3', 'min'], ['C3', 'maj'], ['A#2', 'maj'], ['G2', 'min'], ['A2', 'maj'], ['A2', 'maj']];
  const prog = [...A, ...A, ...A, ...A, ...B, ...B];
  prog.forEach(([r, k], bar) => {
    const c = chord(r, k), root = c[0];
    // batería: bombo en 1 y 3 (+ empujón en 2.5), caja en 2 y 4, charles en corcheas
    for (const b of [0, 2, 2.5]) s.put(INST.bombo(), s.at(bar, b), { gain: 0.8, wet: 0.05 });
    for (const b of [1, 3]) s.put(INST.caja(), s.at(bar, b), { gain: 0.45, pan: 0.05, wet: 0.2 });
    for (let k = 0; k < 8; k++) s.put(INST.charles({ open: k === 7 }), s.at(bar, k * 0.5), { gain: k % 2 ? 0.12 : 0.18, pan: -0.35, wet: 0.08 });
    if (bar % 8 === 0) s.put(INST.platillo(), s.at(bar), { gain: 0.22, pan: 0.4, wet: 0.3 });
    // bajo galopante en corcheas (raíz y octava)
    for (let k = 0; k < 8; k++) s.put(INST.bajoRock(midi((k % 4 === 3 ? root : root - 12)), s.beat * 0.42), s.at(bar, k * 0.5), { gain: 0.32, wet: 0.03 });
    // guitarra: acentos en 1, 1.5(sordina), 2.5, 3.5 + sordinas
    const pat = [[0, 0.9, false], [1, 0.4, true], [1.5, 0.4, true], [2.5, 0.9, false], [3.5, 0.45, true]];
    for (const [b, d, mute] of pat) { s.put(INST.guitarra(midi(root), s.beat * d, { mute }), s.at(bar, b), { gain: 0.12, pan: -0.55, wet: 0.12 });
      s.put(INST.guitarra(midi(root) * 1.002, s.beat * d, { mute }), s.at(bar, b + 0.01), { gain: 0.11, pan: 0.55, wet: 0.12 }); }
    // metales: golpes al empezar las secciones A
    if (bar < 16 && bar % 4 === 0) for (const n of c) s.put(INST.metales(midi(n + 12), s.beat * 1.5), s.at(bar), { gain: 0.09, pan: 0.2, wet: 0.3 });
    if (bar >= 16) for (const n of c) s.put(INST.cuerdas(midi(n + 12), s.beat * 4), s.at(bar), { gain: 0.05, pan: 0.3, wet: 0.4 });
  });
  // redoble final para volver al principio
  for (let k = 0; k < 8; k++) s.put(INST.caja(), s.at(31, 2 + k * 0.25), { gain: 0.28 + k * 0.04, wet: 0.2 });
  const melA = mel(`D5:0.5 F5:0.5 A5:1 G5:0.5 F5:0.5 E5:0.5 F5:0.5  D5:1.5 A#4:0.5 C5:0.5 D5:0.5 F5:1  E5:0.5 G5:0.5 C6:1 A#5:0.5 A5:0.5 G5:0.5 A5:0.5  E5:2 C#5:1 A4:1
    D5:0.5 F5:0.5 A5:1 D6:1 C6:0.5 A5:0.5  A#5:1.5 A5:0.5 G5:0.5 F5:0.5 D5:1  E5:0.5 F5:0.5 G5:0.5 E5:0.5 C5:1 E5:1  A5:2 G5:0.5 F5:0.5 E5:0.5 C#5:0.5`);
  const melB = mel(`A#5:1 A5:0.5 G5:0.5 D5:1 G5:1  A5:1.5 G5:0.5 E5:1 C#5:1  D5:0.5 E5:0.5 F5:0.5 A5:0.5 D6:2  C6:1 A#5:0.5 A5:0.5 G5:1 E5:1
    F5:1 D5:0.5 F5:0.5 A#5:1 A5:0.5 G5:0.5  G5:1 D5:1 A#4:1 D5:1  E5:1 C#5:0.5 E5:0.5 A5:1 G5:0.5 E5:0.5  A5:3 r:1`);
  s.melody('lider', 0, mel('r:16'), {});
  s.melody('lider', 8, melA, { gain: 0.22, pan: 0.1, wet: 0.25, legato: 0.9, glide: true });
  s.melody('metales', 0, melA.map(x => ({ ...x, n: x.n !== null ? x.n - 12 : null })), { gain: 0.07, pan: -0.2, wet: 0.3, legato: 0.85 });
  s.melody('lider', 16, melB, { gain: 0.22, pan: 0.1, wet: 0.25, legato: 0.9, glide: true });
  s.melody('lider', 24, melB, { gain: 0.2, pan: 0.1, wet: 0.25, legato: 0.9, glide: true, transpose: 12 });
  s.melody('lider', 24, melB, { gain: 0.1, pan: -0.2, wet: 0.25, legato: 0.9 });
  return s.render(0.8, 0.19);   // intenso
};

// 3) Mazmorra — Mi menor, 70 ppm: notas graves sostenidas, coro, campanas sueltas, tambores y gotas
SONGS.mazmorra = () => {
  const s = new Song(70, 16);
  const prog = [['E2', 'min'], ['C2', 'maj'], ['A2', 'min'], ['B2', 'maj'], ['E2', 'min'], ['C2', 'maj'], ['A2', 'min'], ['B2', 'maj']];
  for (let bar = 0; bar < 16; bar++) {
    const [r, k] = prog[bar % 8], c = chord(r, k);
    s.put(INST.cuerdas(midi(c[0]), s.beat * 4), s.at(bar), { gain: 0.16, pan: -0.2, wet: 0.45 });
    s.put(INST.cuerdas(midi(c[2]), s.beat * 4), s.at(bar), { gain: 0.11, pan: 0.2, wet: 0.45 });
    s.put(INST.coro(midi(c[1] + 24), s.beat * 4), s.at(bar), { gain: 0.07, pan: 0.3, wet: 0.6 });
    s.put(INST.bajo(midi(c[0] - 12), s.beat * 3.6), s.at(bar), { gain: 0.3, wet: 0.2 });
    if (bar % 2 === 0) { s.put(INST.tambor(62), s.at(bar), { gain: 0.6, wet: 0.35 }); s.put(INST.tambor(58), s.at(bar, 2.5), { gain: 0.35, wet: 0.35 }); }
    if (bar % 4 === 3) s.put(INST.tambor(80), s.at(bar, 3.5), { gain: 0.3, wet: 0.35 });
  }
  seed = 707;   // gotas que caen
  for (let k = 0; k < 18; k++) s.put(INST.campana(midi(nm('E6') + [0, 3, 7, 10, 12][Math.floor(rnd() * 5)]), 0.3), rnd() * (s.len - 2), { gain: 0.035, pan: rnd() * 1.6 - 0.8, wet: 0.7 });
  const motif = mel(`E5:2 G5:2  F#5:3 E5:1  C5:2 B4:2  D#5:4  E5:1 B4:1 G5:2  A5:2 G5:2  F#5:2 E5:1 D#5:1  B4:4`);
  s.melody('campana', 0, motif, { gain: 0.14, pan: 0.15, wet: 0.55 });
  s.melody('campana', 8, motif.map(x => ({ ...x, n: x.n !== null ? x.n - 12 : null })), { gain: 0.13, pan: -0.15, wet: 0.55 });
  s.melody('flauta', 8, mel('r:8 E5:2 G5:2 F#5:2 E5:1 D#5:1 B4:4'), { gain: 0.12, pan: 0.1, wet: 0.5 });
  return s.render(1.4, 0.11);   // contenido, para que se oigan los pasos y los efectos
};

// ── Instrumentos extra ──
Object.assign(INST, {
  marimba: (f, dur) => { const len = Math.max(dur, 0.7), b = new Float32Array(N(len));
    for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 7) + Math.sin(2 * Math.PI * f * 4 * t) * 0.25 * Math.exp(-t * 30); }
    return b; },
  pizz: (f, dur) => { const b = INST.arpa(f, 0.35); for (let i = 0; i < b.length; i++) b[i] *= Math.exp(-(i / SR) * 9); return b; },
  acordeon: (f, dur) => { const b = add(osc(dur + 0.08, f, { wave: 'square', duty: 0.32, vib: 0.006, vibRate: 5.5, vibDelay: 0.1 }), osc(dur + 0.08, f * 1.004, { wave: 'saw' }), 0.5);
    for (let i = 0; i < b.length; i++) b[i] *= 0.85 + 0.15 * Math.sin(2 * Math.PI * 6 * i / SR);
    return lp(env(b, 0.03, 0.1, 0.8, 0.08, dur), 2600); },
  cajaMusica: (f, dur) => { const len = 1.4, b = new Float32Array(N(len));
    for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 3.01 * t) * Math.exp(-t * 6)) * Math.exp(-t * 3.2); }
    return b; },
  bajoPulsado: (f, dur) => { const b = INST.arpa(f, Math.max(dur, 0.5)); return lp(b, 700); },
  timbal: (f = 90) => INST.tambor(f),
});
/// Batería de rock por compás (bombo/caja/charles); dbl = doble bombo en semicorcheas
function rockDrums(s, bar, o = {}) {
  const { dbl = false, crash = false, soft = 1 } = o;
  if (dbl) for (let k = 0; k < 16; k++) s.put(INST.bombo(), s.at(bar, k * 0.25), { gain: (k % 4 === 0 ? 0.8 : 0.45) * soft, wet: 0.04 });
  else for (const b of [0, 2, 2.5]) s.put(INST.bombo(), s.at(bar, b), { gain: 0.8 * soft, wet: 0.05 });
  for (const b of [1, 3]) s.put(INST.caja(), s.at(bar, b), { gain: 0.45 * soft, pan: 0.05, wet: 0.2 });
  for (let k = 0; k < 8; k++) s.put(INST.charles({ open: k === 7 }), s.at(bar, k * 0.5), { gain: (k % 2 ? 0.11 : 0.17) * soft, pan: -0.35, wet: 0.08 });
  if (crash) s.put(INST.platillo(), s.at(bar), { gain: 0.22 * soft, pan: 0.4, wet: 0.3 });
}
const pad = (s, bar, c, beats, gain = 0.07, wet = 0.45, oct = 12) => c.forEach((n, i) => s.put(INST.cuerdas(midi(n + oct), s.beat * beats), s.at(bar), { gain, pan: (i - 1) * 0.3, wet }));
const lower = (m, k = 12) => m.map(x => ({ ...x, n: x.n !== null ? x.n - k : null }));

// 4) Título — Do menor → Mi bemol, 84 ppm: intro íntima (campanas + cuerdas) que crece a una melodía heroica
SONGS.titulo = () => {
  // 2026-10-12: 112 ppm (antes 84), intro de 2 compases (antes 4, se hacía larga y floja) y pulso desde el principio
  const s = new Song(112, 14);
  const prog = [['C3', 'min'], ['G#2', 'maj'],
                ['C3', 'min'], ['G#2', 'maj'], ['D#3', 'maj'], ['G2', 'maj'],
                ['G#2', 'maj'], ['A#2', 'maj'], ['D#3', 'maj'], ['C3', 'min'], ['G#2', 'maj'], ['A#2', 'maj'], ['G2', 'maj'], ['G2', 'maj']];
  const M = 2;   // compás en que entra la melodía
  prog.forEach(([r, k], bar) => { const c = chord(r, k);
    pad(s, bar, c, 4, bar < M ? 0.075 : 0.08);
    if (bar >= M) s.put(INST.coro(midi(c[1] + 24), s.beat * 4), s.at(bar), { gain: 0.05, pan: 0.3, wet: 0.6 });
    for (let k = 0; k < 8; k++) s.put(INST.bajo(midi((k === 3 || k === 7 ? c[2] : c[0]) - 12), s.beat * 0.45), s.at(bar, k * 0.5), { gain: (k % 2 ? 0.26 : 0.36) * (bar < M ? 0.75 : 1), wet: 0.1 });
    s.put(INST.timbal(70), s.at(bar), { gain: bar < M ? 0.35 : 0.5, wet: 0.35 }); s.put(INST.timbal(70), s.at(bar, 2.5), { gain: 0.3, wet: 0.35 });
    if (bar >= M + 4) rockDrums(s, bar, { soft: 0.5, crash: bar === M + 4 || bar === M + 8 });
    else for (let k = 0; k < 8; k++) s.put(INST.charles({ open: k === 7 }), s.at(bar, k * 0.5), { gain: k % 2 ? 0.06 : 0.1, pan: -0.35, wet: 0.08 });
    if (bar === M) s.put(INST.platillo(), s.at(bar), { gain: 0.2, pan: 0.3, wet: 0.4 });
    if (bar >= M + 4) [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].forEach((b, k) => s.put(INST.arpa(midi([c[0], c[1], c[2], c[1]][k % 4] + 24), s.beat * 0.5), s.at(bar, b), { gain: 0.07, pan: 0.4, wet: 0.4 }));
  });
  // sin campanas (2026-10-12: al usuario no le pegaban); la intro es solo el pulso de bajo, timbal y cuerdas
  const heroic = mel(`G4:1 C5:1 D5:1 D#5:1  D#5:1.5 D5:0.5 C5:1 G#4:1  A#4:1 D#5:1 G5:1.5 F5:0.5  D5:3 B4:1
    C5:1 D#5:1 G#5:2  G5:1 F5:1 D5:1 A#4:1  D#5:1.5 F5:0.5 G5:1 A#5:1  G5:2 D#5:1 C5:1
    G#5:1.5 G5:0.5 F5:1 D#5:1  F5:1 G5:1 A#5:2  B5:2 D6:1 B5:1  G5:4`);
  s.melody('metales', M, heroic, { gain: 0.16, pan: -0.05, wet: 0.35, legato: 0.95 });
  s.melody('flauta', M, heroic.map(x => ({ ...x, n: x.n !== null ? x.n + 12 : null })), { gain: 0.1, pan: 0.15, wet: 0.4, legato: 0.92 });
  return s.render(1.3, 0.13);
};

// 5) Mundo abierto — Sol mayor, 120 ppm: aventura luminosa
SONGS.mundo = () => {
  const s = new Song(120, 24);
  const A = [['G3', 'maj'], ['D3', 'maj'], ['E3', 'min'], ['C3', 'maj'], ['G3', 'maj'], ['D3', 'maj'], ['C3', 'maj'], ['D3', 'maj']];
  const B = [['E3', 'min'], ['C3', 'maj'], ['G3', 'maj'], ['D3', 'maj'], ['C3', 'maj'], ['D3', 'maj'], ['E3', 'min'], ['D3', 'maj']];
  const prog = [...A, ...B, ...A];
  prog.forEach(([r, k], bar) => { const c = chord(r, k);
    pad(s, bar, c, 4, 0.06);
    for (const [b, n] of [[0, c[0]], [1.5, c[2]], [2, c[0]], [3, c[2]], [3.5, c[0] + 12]]) s.put(INST.bajo(midi(n - 12), s.beat * 0.9), s.at(bar, b), { gain: 0.36, wet: 0.08 });
    for (let k = 0; k < 8; k++) s.put(INST.arpa(midi([c[0], c[1], c[2], c[0] + 12][k % 4] + 12), s.beat * 0.5), s.at(bar, k * 0.5), { gain: 0.08, pan: 0.45, wet: 0.3 });
    rockDrums(s, bar, { soft: 0.55, crash: bar % 8 === 0 });
  });
  const melA = mel(`D5:1 G5:1 A5:1 B5:1  A5:1.5 G5:0.5 F#5:1 D5:1  E5:1 G5:1 B5:1.5 A5:0.5  G5:1 E5:1 G5:2
    D5:1 G5:1 A5:1 B5:1  D6:1.5 C6:0.5 B5:1 A5:1  G5:1 E5:1 C6:1 B5:0.5 A5:0.5  A5:4`);
  const melB = mel(`B5:1 A5:0.5 G5:0.5 E5:2  C6:1 B5:0.5 A5:0.5 G5:2  B5:1 G5:1 D5:1 G5:1  F#5:2 A5:2
    E5:1 G5:1 C6:1.5 B5:0.5  A5:1 F#5:1 D5:1 A5:1  G5:1.5 F#5:0.5 E5:1 B5:1  A5:2 D5:2`);
  s.melody('flauta', 0, melA, { gain: 0.26, pan: 0.05, wet: 0.3, legato: 0.92 });
  s.melody('lider', 0, lower(melA), { gain: 0.08, pan: -0.15, wet: 0.25, legato: 0.9 });
  s.melody('flauta', 8, melB, { gain: 0.26, pan: 0.05, wet: 0.3, legato: 0.92 });
  s.melody('metales', 8, lower(melB), { gain: 0.07, pan: -0.2, wet: 0.3 });
  s.melody('lider', 16, melA, { gain: 0.16, pan: 0.05, wet: 0.28, legato: 0.9, glide: true });
  s.melody('flauta', 16, melA, { gain: 0.14, pan: -0.1, wet: 0.3, legato: 0.92 });
  return s.render(1, 0.15);
};

// 6) Fauces del Bosque — Re dórico, 96 ppm: bosque misterioso con ritmo (pizzicato, marimba, flauta, tambores)
SONGS.bosque = () => {
  const s = new Song(96, 16);
  const prog = [['D3', 'min7'], ['G3', 'maj'], ['D3', 'min7'], ['G3', 'maj'], ['F3', 'maj'], ['C3', 'maj'], ['A#2', 'maj'], ['A2', 'maj']];
  for (let bar = 0; bar < 16; bar++) { const [r, k] = prog[bar % 8], c = chord(r, k);
    pad(s, bar, c.slice(0, 3), 4, 0.05, 0.5);
    [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].forEach((b, i) => s.put(INST.pizz(midi([c[0], c[2], c[1] + 12, c[2]][i % 4] + 12), 0.2), s.at(bar, b), { gain: 0.13, pan: i % 2 ? 0.4 : -0.4, wet: 0.25 }));
    s.put(INST.bajoPulsado(midi(c[0] - 12), s.beat * 1.5), s.at(bar), { gain: 0.4, wet: 0.1 }); s.put(INST.bajoPulsado(midi(c[0] - 12), s.beat), s.at(bar, 2.5), { gain: 0.3, wet: 0.1 });
    s.put(INST.tambor(75), s.at(bar), { gain: 0.42, wet: 0.3 }); s.put(INST.tambor(95), s.at(bar, 1.5), { gain: 0.22, wet: 0.3 }); s.put(INST.tambor(75), s.at(bar, 2.75), { gain: 0.3, wet: 0.3 });
    for (let k = 0; k < 8; k++) s.put(INST.maraca(), s.at(bar, k * 0.5), { gain: k % 2 ? 0.05 : 0.08, pan: 0.5, wet: 0.1 });
  }
  const m = mel(`D5:0.5 F5:0.5 A5:1 G5:1 F5:1  E5:1 D5:1 B4:2  D5:0.5 F5:0.5 A5:1 C6:1 A5:1  B5:2 G5:2
    A5:1 G5:0.5 F5:0.5 C5:2  E5:1 G5:1 C6:2  D6:1 C6:0.5 A#5:0.5 F5:2  E5:2 C#5:2`);
  s.melody('flauta', 0, m, { gain: 0.24, pan: 0.05, wet: 0.35, legato: 0.9 });
  s.melody('marimba', 8, m, { gain: 0.2, pan: -0.2, wet: 0.3 });
  s.melody('flauta', 8, lower(m), { gain: 0.15, pan: 0.2, wet: 0.35, legato: 0.9 });
  return s.render(1.1, 0.13);
};

// 7) Jefe — Mi menor, 156 ppm (la de 168 queda como jefe_rapido.*, por si sirve para la fase final): intro amenazante, doble bombo, guitarras, metales, coro
SONGS.jefe = () => {
  const s = new Song(156, 36);
  const A = [['E3', 'min'], ['C3', 'maj'], ['D3', 'maj'], ['B2', 'maj'], ['E3', 'min'], ['C3', 'maj'], ['A2', 'min'], ['B2', 'maj']];
  const B = [['C3', 'maj'], ['D3', 'maj'], ['E3', 'min'], ['E3', 'min'], ['C3', 'maj'], ['D3', 'maj'], ['B2', 'maj'], ['B2', 'maj']];
  const prog = [['E3', 'min'], ['E3', 'min'], ['E3', 'min'], ['E3', 'min'], ...A, ...B, ...A, ...B];
  prog.forEach(([r, k], bar) => { const c = chord(r, k), root = c[0];
    if (bar < 4) {   // intro: golpes de metales y timbales, el coro sube
      for (const b of [0, 1.5, 3]) { c.forEach(n => s.put(INST.metales(midi(n), s.beat * 0.6), s.at(bar, b), { gain: 0.08, wet: 0.3 })); s.put(INST.timbal(60), s.at(bar, b), { gain: 0.55, wet: 0.3 }); }
      s.put(INST.coro(midi(nm('E4') + bar), s.beat * 4), s.at(bar), { gain: 0.06 + bar * 0.01, wet: 0.6 });
      if (bar === 3) for (let k = 0; k < 8; k++) s.put(INST.caja(), s.at(bar, 2 + k * 0.25), { gain: 0.25 + k * 0.04, wet: 0.2 });
      return; }
    rockDrums(s, bar, { dbl: bar >= 20, crash: (bar - 4) % 8 === 0 });
    for (let k = 0; k < 8; k++) s.put(INST.bajoRock(midi(k % 2 ? root : root - 12), s.beat * 0.42), s.at(bar, k * 0.5), { gain: 0.32, wet: 0.03 });
    for (let k = 0; k < 8; k++) { const accent = k === 0 || k === 3 || k === 6;
      s.put(INST.guitarra(midi(root), s.beat * (accent ? 0.9 : 0.4), { mute: !accent }), s.at(bar, k * 0.5), { gain: 0.11, pan: -0.55, wet: 0.1 });
      s.put(INST.guitarra(midi(root) * 1.002, s.beat * (accent ? 0.9 : 0.4), { mute: !accent }), s.at(bar, k * 0.5 + 0.01), { gain: 0.1, pan: 0.55, wet: 0.1 }); }
    s.put(INST.coro(midi(c[1] + 12), s.beat * 4), s.at(bar), { gain: 0.05, pan: 0.2, wet: 0.5 });
    if (bar % 2 === 0) c.forEach(n => s.put(INST.metales(midi(n + 12), s.beat * 0.7), s.at(bar, 0), { gain: 0.06, pan: -0.1, wet: 0.3 }));
  });
  const melA = mel(`E5:0.5 E5:0.5 G5:0.5 E5:0.5 B5:1 A5:1  G5:0.5 A5:0.5 G5:0.5 E5:0.5 C5:2  D5:0.5 F#5:0.5 A5:1 D6:1 C6:1  B5:1.5 A5:0.5 G5:1 D#5:1
    E5:0.5 G5:0.5 B5:1 E6:1 D6:0.5 B5:0.5  C6:1.5 B5:0.5 A5:1 G5:1  A5:0.5 G5:0.5 E5:0.5 C5:0.5 E5:1 A5:1  B5:2 D#6:2`);
  const melB = mel(`G5:1 C6:1 B5:1 G5:1  A5:1 D6:1 C6:1 A5:1  B5:1.5 A5:0.5 G5:1 E5:1  B4:1 E5:1 G5:1 B5:1
    C6:2 B5:1 A5:1  D6:2 C6:1 B5:1  B5:1 A5:1 G5:1 F#5:1  D#5:2 B4:2`);
  s.melody('lider', 4, melA, { gain: 0.2, pan: 0.1, wet: 0.22, legato: 0.88, glide: true });
  s.melody('lider', 12, melB, { gain: 0.2, pan: 0.1, wet: 0.22, legato: 0.9, glide: true });
  s.melody('metales', 12, lower(melB), { gain: 0.08, pan: -0.2, wet: 0.3 });
  s.melody('lider', 20, melA, { gain: 0.17, pan: 0.1, wet: 0.22, legato: 0.88, glide: true, transpose: 12 });
  s.melody('lider', 20, melA, { gain: 0.1, pan: -0.25, wet: 0.22, legato: 0.88 });
  s.melody('lider', 28, melB, { gain: 0.2, pan: 0.1, wet: 0.22, legato: 0.9, glide: true });
  s.melody('metales', 28, melB, { gain: 0.07, pan: -0.2, wet: 0.3 });
  return s.render(0.8, 0.19);
};

// 8) Tienda — Si bemol mayor, 108 ppm: alegre y saltarina (marimba, acordeón, bajo de "chumpa")
SONGS.tienda = () => {
  const s = new Song(108, 16);
  const prog = [['A#2', 'maj'], ['G2', 'min'], ['C3', 'min'], ['F2', 'maj'], ['A#2', 'maj'], ['G2', 'min'], ['D#2', 'maj'], ['A#2', 'maj'],
                ['D#2', 'maj'], ['A#2', 'maj'], ['C3', 'min'], ['F2', 'maj'], ['D#2', 'maj'], ['A#2', 'maj'], ['C3', 'dom7'], ['F2', 'maj']];
  prog.forEach(([r, k], bar) => { const c = chord(r, k);
    s.put(INST.bajoPulsado(midi(c[0]), s.beat * 0.9), s.at(bar, 0), { gain: 0.45, wet: 0.08 }); s.put(INST.bajoPulsado(midi(c[2] - 12), s.beat * 0.9), s.at(bar, 2), { gain: 0.4, wet: 0.08 });
    for (const b of [1, 3]) c.slice(0, 3).forEach((n, i) => s.put(INST.marimba(midi(n + 12), 0.3), s.at(bar, b), { gain: 0.09, pan: (i - 1) * 0.4, wet: 0.2 }));
    for (let k = 0; k < 8; k++) s.put(INST.maraca(), s.at(bar, k * 0.5), { gain: k % 2 ? 0.05 : 0.08, pan: 0.45, wet: 0.08 });
    s.put(INST.bombo(), s.at(bar, 0), { gain: 0.35, wet: 0.05 }); s.put(INST.caja(), s.at(bar, 3), { gain: 0.14, wet: 0.2 });
  });
  const melA = mel(`F5:0.5 D5:0.5 F5:0.5 A#5:0.5 A5:1 F5:1  G5:0.5 F5:0.5 D5:0.5 G5:0.5 A#5:2  C5:0.5 D#5:0.5 G5:0.5 C6:0.5 A#5:1 G5:1  A5:1 F5:1 C5:2
    D5:0.5 F5:0.5 A#5:1 C6:0.5 A#5:0.5 A5:1  G5:1 D5:1 G5:1 A5:1  A#5:1 G5:1 A5:1 F5:1  A#5:2 r:2`);
  const melB = mel(`G5:1 A#5:1 D#6:1.5 D6:0.5  D6:1 A#5:1 F5:2  D#6:1 D6:0.5 C6:0.5 G5:2  A5:1 C6:1 A5:2
    G5:0.5 A5:0.5 A#5:0.5 G5:0.5 D#5:2  F5:0.5 G5:0.5 A#5:0.5 F5:0.5 D5:2  E5:1 G5:1 C6:1 A#5:1  A5:2 F5:1 r:1`);
  s.melody('acordeon', 0, melA, { gain: 0.2, pan: 0.05, wet: 0.2, legato: 0.85 });
  s.melody('marimba', 8, melB, { gain: 0.22, pan: -0.1, wet: 0.2 });
  s.melody('acordeon', 8, melB, { gain: 0.14, pan: 0.15, wet: 0.2, legato: 0.85 });
  return s.render(0.8, 0.13);
};

// 9) Posada / noche — Re mayor en 3/4, 76 ppm: vals tranquilo con caja de música
SONGS.posada = () => {
  const s = new Song(76, 16, 3);
  const prog = [['D3', 'maj'], ['B2', 'min'], ['G2', 'maj'], ['A2', 'maj'], ['D3', 'maj'], ['F#2', 'min'], ['G2', 'maj'], ['A2', 'maj'],
                ['G2', 'maj'], ['A2', 'maj'], ['F#2', 'min'], ['B2', 'min'], ['G2', 'maj'], ['A2', 'maj'], ['D3', 'maj'], ['D3', 'maj']];
  prog.forEach(([r, k], bar) => { const c = chord(r, k);
    s.put(INST.bajo(midi(c[0] - 12), s.beat * 2.6), s.at(bar, 0), { gain: 0.32, wet: 0.2 });
    [1, 2].forEach(b => s.put(INST.arpa(midi(c[1] + 12), s.beat * 0.8), s.at(bar, b), { gain: 0.1, pan: -0.3, wet: 0.35 }) || s.put(INST.arpa(midi(c[2] + 12), s.beat * 0.8), s.at(bar, b), { gain: 0.09, pan: 0.3, wet: 0.35 }));
    pad(s, bar, c, 3, 0.045, 0.55);
  });
  const m = mel(`F#5:1 A5:1 D6:1  C#6:2 B5:1  B5:1 G5:1 D5:1  E5:3  F#5:1 A5:1 F#5:1  E5:1 C#5:1 A4:1  B4:1 D5:1 G5:1  A5:3
    B5:1.5 A5:0.5 G5:1  A5:1.5 G5:0.5 E5:1  F#5:1 A5:1 C#6:1  B5:2 F#5:1  G5:1 B5:1 D6:1  C#6:1 B5:1 A5:1  A5:1 F#5:1 E5:1  D5:3`);
  s.melody('cajaMusica', 0, m.map(x => ({ ...x, n: x.n !== null ? x.n + 12 : null })), { gain: 0.11, pan: 0.15, wet: 0.45 });
  s.melody('flauta', 0, m, { gain: 0.2, pan: -0.05, wet: 0.4, legato: 0.95 });
  return s.render(1.3, 0.1);
};

// 10) Victoria — Do mayor, 120 ppm: fanfarria corta (no es bucle)
SONGS.victoria = () => {
  const s = new Song(120, 4); s.noLoop = true;
  const prog = [['C3', 'maj'], ['F3', 'maj'], ['G3', 'maj'], ['C3', 'maj']];
  for (let k = 0; k < 8; k++) s.put(INST.caja(), s.at(0, k * 0.25), { gain: 0.2 + k * 0.03, wet: 0.2 });
  prog.forEach(([r, k], bar) => { const c = chord(r, k);
    c.forEach(n => s.put(INST.metales(midi(n + 12), s.beat * (bar === 3 ? 3.5 : 1.8)), s.at(bar, bar === 0 ? 2 : 0), { gain: 0.09, pan: 0, wet: 0.35 }));
    s.put(INST.bajo(midi(c[0] - 12), s.beat * 1.8), s.at(bar, bar === 0 ? 2 : 0), { gain: 0.35, wet: 0.15 });
    if (bar) s.put(INST.timbal(80), s.at(bar), { gain: 0.5, wet: 0.3 });
  });
  s.put(INST.platillo(), s.at(1), { gain: 0.22, wet: 0.4 }); s.put(INST.platillo(), s.at(3), { gain: 0.3, wet: 0.4 });
  const m = mel(`r:2 G4:0.5 C5:0.5 E5:0.5 G5:0.5  F5:1 A5:1 C6:2  B5:0.5 G5:0.5 D6:1 B5:1 G5:1  C6:4`);
  s.melody('lider', 0, m, { gain: 0.2, wet: 0.35, legato: 0.92, glide: true });
  s.melody('metales', 0, lower(m), { gain: 0.1, pan: -0.2, wet: 0.35 });
  return s.render(1.2, 0.17);
};

// ── Instrumentos para caballero oscuro, nieve y desierto ──
Object.assign(INST, {
  // órgano de tubos: armónicos tipo registros + trémolo suave
  organo: (f, dur) => { const len = dur + 0.35, b = new Float32Array(N(len)), H = [[1, 1], [2, 0.6], [3, 0.35], [4, 0.3], [6, 0.15], [8, 0.1], [0.5, 0.45]];
    for (let i = 0; i < b.length; i++) { const t = i / SR; let v = 0; for (const [h, g] of H) v += Math.sin(2 * Math.PI * f * h * t) * g; b[i] = v * 0.35 * (1 + 0.07 * Math.sin(2 * Math.PI * 5.8 * t)); }
    return lp(env(b, 0.06, 0.1, 0.9, 0.3, dur), 3500); },
  campanaIglesia: (f, dur) => { const len = Math.max(dur, 4.5), b = new Float32Array(N(len));
    for (let i = 0; i < b.length; i++) { const t = i / SR; let v = 0;
      for (const [r, g, d] of [[0.5, 0.5, 0.4], [1, 1, 0.6], [1.19, 0.6, 0.8], [1.5, 0.4, 1], [2, 0.5, 1.2], [2.52, 0.25, 1.6], [3, 0.2, 2]]) v += Math.sin(2 * Math.PI * f * r * t) * g * Math.exp(-t * d);
      b[i] = v * 0.4 * Math.min(1, t / 0.004); }
    return b; },
  cascabeles: () => { const b = new Float32Array(N(0.35));
    for (const o of [0, 0.045, 0.085]) { const s0 = N(o); for (let i = 0; i + s0 < b.length; i++) { const t = i / SR, e = Math.exp(-t * 35);
      b[i + s0] += (Math.sin(2 * Math.PI * 5200 * t) + Math.sin(2 * Math.PI * 6650 * t) * 0.7 + Math.sin(2 * Math.PI * 8100 * t) * 0.5 + (rnd() * 2 - 1) * 0.6) * e * 0.25; } }
    return hp(b, 4000); },
  // ney: caña con aire (triángulo + soplido), entra un pelo bajo y vibrato marcado
  ney: (f, dur) => { const b = add(osc(dur + 0.15, f, { wave: 'tri', vib: 0.016, vibRate: 5.2, vibDelay: 0.18, glideFrom: f * 0.965, glide: 0.07 }),
      bp(noise(dur + 0.15), f * 2, 3), 0.12);
    return lp(env(b, 0.06, 0.1, 0.85, 0.15, dur), 3800); },
  // laúd (oud): cuerda pulsada brillante que se apaga antes que el arpa
  laud: (f, dur) => { const len = Math.max(dur, 0.8), b = new Float32Array(N(len)), L = Math.max(2, Math.round(SR / f)), ring = new Float32Array(L);
    for (let i = 0; i < L; i++) ring[i] = rnd() * 2 - 1; let idx = 0;
    for (let i = 0; i < b.length; i++) { const a = ring[idx], c = ring[(idx + 1) % L]; ring[idx] = (a * 0.7 + c * 0.3) * 0.995; b[i] = a * Math.exp(-(i / SR) * 2.4); idx = (idx + 1) % L; }
    return lp(b, 3800); },
  dum: () => INST.tambor(105),
  tek: () => add(env(bp(noise(0.09), 3200, 1.2), 0.0005, 0.02, 0.15, 0.05, 0.02), env(osc(0.05, 420, { wave: 'tri' }), 0.0005, 0.02, 0.2, 0.02, 0.02), 0.4),
  pandereta: () => add(env(hp(noise(0.12), 7500), 0.001, 0.03, 0.2, 0.06, 0.02), INST.cascabeles(), 0.25),
});

// 11) Caballero oscuro — jefe solemne, Re menor armónico, 128 ppm (a 100 era demasiado lento para pelear): campanas, órgano, coro, metales, timbales
SONGS.caballero_oscuro = () => {
  const s = new Song(128, 24);
  const prog = [['D3', 'min'], ['D3', 'min'], ['A#2', 'maj'], ['A2', 'maj'],
    ['D3', 'min'], ['G2', 'min'], ['A2', 'maj'], ['D3', 'min'], ['A#2', 'maj'], ['G2', 'min'], ['A2', 'maj'], ['A2', 'maj'],
    ['G2', 'min'], ['D3', 'min'], ['A#2', 'maj'], ['A2', 'maj'], ['G2', 'min'], ['D#3', 'maj'], ['A2', 'maj'], ['A2', 'maj'],
    ['D3', 'min'], ['A#2', 'maj'], ['A2', 'maj'], ['A2', 'maj']];
  prog.forEach(([r, k], bar) => { const c = chord(r, k), root = c[0];
    const loud = bar >= 20 ? 1.25 : bar >= 12 ? 1.1 : 1;
    c.forEach((n, i) => s.put(INST.organo(midi(n + 12), s.beat * 3.9), s.at(bar), { gain: 0.05 * loud, pan: (i - 1) * 0.35, wet: 0.5 }));
    s.put(INST.organo(midi(root - 12), s.beat * 3.9), s.at(bar), { gain: 0.07 * loud, wet: 0.45 });
    if (bar < 4 || bar >= 20) { if (bar % 2 === 0) s.put(INST.campanaIglesia(midi(root + 12), 4), s.at(bar), { gain: 0.16, pan: 0.2, wet: 0.6 }); }
    if (bar >= 4) s.put(INST.coro(midi(c[1] + 24), s.beat * 4), s.at(bar), { gain: 0.07 * loud, pan: -0.25, wet: 0.6 });
    if (bar >= 12) {
      for (let k = 0; k < 8; k++) s.put(INST.cuerdas(midi((k % 4 === 2 ? root + 12 : root)), s.beat * 0.45), s.at(bar, k * 0.5), { gain: 0.09, pan: -0.4, wet: 0.25 });
      s.put(INST.timbal(62), s.at(bar), { gain: 0.6, wet: 0.35 }); s.put(INST.timbal(62), s.at(bar, 2), { gain: 0.45, wet: 0.35 });
      if (bar % 4 === 3) for (let k = 0; k < 4; k++) s.put(INST.timbal(70), s.at(bar, 3 + k * 0.25), { gain: 0.3 + k * 0.08, wet: 0.35 });
    } else if (bar >= 4) s.put(INST.timbal(60), s.at(bar), { gain: 0.4, wet: 0.4 });
    if (bar >= 20) { s.put(INST.bombo(), s.at(bar), { gain: 0.6, wet: 0.3 }); if (bar === 20) s.put(INST.platillo(), s.at(bar), { gain: 0.3, wet: 0.5 });
      for (let k = 0; k < 8; k++) s.put(INST.timbal(k % 2 ? 72 : 62), s.at(bar, k * 0.5), { gain: 0.32, wet: 0.3 }); }
    // caja militar: golpes en 2 y 4 con redoble de semicorcheas al final del compás (batalla solemne)
    if (bar >= 8) { for (const b of [1, 3]) s.put(INST.caja(), s.at(bar, b), { gain: 0.3, pan: 0.15, wet: 0.3 });
      for (let k = 0; k < 4; k++) s.put(INST.caja(), s.at(bar, 3.5 + k * 0.125), { gain: 0.1 + k * 0.03, pan: 0.15, wet: 0.3 }); }
  });
  s.melody('organo', 0, mel('D4:4 A3:2 F4:2 A#3:2 D4:2 C#4:4'), { gain: 0.08, wet: 0.5 });
  const melA = mel(`D5:2 F5:1 E5:1  D5:2 A#4:2  C#5:2 E5:1 A5:1  F5:3 E5:1  D5:2 F5:2  G5:2 A#5:1 A5:1  G5:1 F5:1 E5:1 C#5:1  A4:4`);
  const melB = mel(`G5:1.5 A5:0.5 A#5:2  A5:1.5 F5:0.5 D5:2  F5:1.5 G5:0.5 A5:1 A#5:1  A5:3 G5:0.5 E5:0.5
    A#5:1.5 A5:0.5 G5:1 D6:1  C6:2 A#5:1 G5:1  A5:1 C#6:1 E6:1 C#6:1  A5:4`);
  s.melody('coro', 4, melA, { gain: 0.11, pan: 0.05, wet: 0.55, legato: 1 });
  s.melody('organo', 4, melA, { gain: 0.06, pan: 0.2, wet: 0.5 });
  s.melody('metales', 12, melB, { gain: 0.16, pan: 0.05, wet: 0.35, legato: 0.95 });
  s.melody('coro', 12, lower(melB), { gain: 0.07, pan: -0.2, wet: 0.55, legato: 1 });
  s.melody('metales', 20, mel('D5:1 E5:1 F5:1 G5:1  F5:2 D5:2  E5:1 F5:1 G5:1 A5:1  C#5:4'), { gain: 0.17, wet: 0.35 });
  s.melody('organo', 20, mel('D5:1 E5:1 F5:1 G5:1  F5:2 D5:2  E5:1 F5:1 G5:1 A5:1  C#5:4'), { gain: 0.07, wet: 0.5 });
  return s.render(1.5, 0.15);
};

// 12) Nieve — Re mayor con toque lidio, 80 ppm: celesta, arpa, flauta, cuerdas suaves, cascabeles
SONGS.nieve = () => {
  const s = new Song(80, 16);
  const prog = [['D3', 'maj'], ['E3', 'maj'], ['B2', 'min'], ['G2', 'maj'], ['D3', 'maj'], ['E3', 'maj'], ['F#2', 'min'], ['A2', 'maj'],
                ['G2', 'maj'], ['A2', 'maj'], ['F#2', 'min'], ['B2', 'min'], ['G2', 'maj'], ['E3', 'maj'], ['A2', 'maj'], ['A2', 'maj']];
  prog.forEach(([r, k], bar) => { const c = chord(r, k);
    pad(s, bar, c, 4, 0.05, 0.6);
    s.put(INST.bajo(midi(c[0] - 12), s.beat * 3.6), s.at(bar), { gain: 0.25, wet: 0.25 });
    [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].forEach((b, i) => s.put(INST.cajaMusica(midi([c[0], c[1], c[2], c[1]][i % 4] + 36), 0.3), s.at(bar, b), { gain: 0.035, pan: i % 2 ? 0.5 : -0.5, wet: 0.5 }));
    [0, 1.5, 3].forEach((b, i) => s.put(INST.arpa(midi(c[i] + 12), s.beat), s.at(bar, b), { gain: 0.08, pan: -0.2, wet: 0.45 }));
    for (const b of [1, 3]) s.put(INST.cascabeles(), s.at(bar, b), { gain: 0.05, pan: 0.45, wet: 0.35 });
  });
  const m = mel(`F#5:1 A5:1 G#5:1 A5:1  B5:2 E5:2  D5:1 F#5:1 B5:1 A5:1  G5:2 D5:2  F#5:1 A5:1 D6:1 C#6:1  B5:1.5 G#5:0.5 E5:2  A5:1 C#6:1 F#5:2  E5:4
    D5:1 G5:1 B5:2  C#6:1 B5:1 A5:2  A5:1 F#5:1 C#5:2  D5:1 F#5:1 B5:2  B5:1 D6:1 G5:2  G#5:2 B5:2  A5:1 E5:1 C#5:1 E5:1  A5:4`);
  s.melody('cajaMusica', 0, m.map(x => ({ ...x, n: x.n !== null ? x.n + 12 : null })), { gain: 0.1, pan: 0.15, wet: 0.5 });
  s.melody('flauta', 0, m, { gain: 0.18, pan: -0.05, wet: 0.45, legato: 0.95 });
  return s.render(1.5, 0.1);
};

// 13) Desierto — Re frigio dominante, 100 ppm: ney, laúd, darbuka (maqsum), pandereta y nota grave sostenida
SONGS.desierto = () => {
  const s = new Song(100, 16);
  const prog = [['D3', 'maj'], ['D#3', 'maj'], ['D3', 'maj'], ['C3', 'min'], ['A#2', 'maj'], ['C3', 'min'], ['D3', 'maj'], ['D3', 'maj']];
  for (let bar = 0; bar < 16; bar++) { const [r, k] = prog[bar % 8], c = chord(r, k);
    s.put(INST.cuerdas(midi(nm('D2')), s.beat * 4), s.at(bar), { gain: 0.1, wet: 0.35 }); s.put(INST.cuerdas(midi(nm('A2')), s.beat * 4), s.at(bar), { gain: 0.07, wet: 0.35 });
    // maqsum: D T . T D . T .
    [[0, 'dum'], [0.5, 'tek'], [1.5, 'tek'], [2, 'dum'], [3, 'tek']].forEach(([b, w]) => s.put(INST[w](), s.at(bar, b), { gain: w === 'dum' ? 0.55 : 0.3, pan: w === 'dum' ? 0 : 0.25, wet: 0.2 }));
    for (let k = 0; k < 16; k++) if (k % 4 !== 0) s.put(INST.pandereta(), s.at(bar, k * 0.25), { gain: k % 2 ? 0.03 : 0.05, pan: -0.45, wet: 0.15 });
    // laúd: rasgueo del acorde y respuesta
    c.forEach((n, i) => s.put(INST.laud(midi(n + 12), 0.6), s.at(bar, i * 0.03), { gain: 0.1, pan: 0.35, wet: 0.25 }));
    s.put(INST.laud(midi(c[0] + 12), 0.4), s.at(bar, 2.5), { gain: 0.09, pan: 0.35, wet: 0.25 });
  }
  const m = mel(`D5:0.5 D#5:0.5 F#5:1 G5:0.5 F#5:0.5 D#5:1  D5:1 D#5:0.5 D5:0.5 C5:2  D5:0.5 F#5:0.5 A5:1 A#5:0.5 A5:0.5 G5:1  F#5:1 G5:0.5 F#5:0.5 D#5:2
    D5:1 G5:1 F#5:1 D#5:1  D5:1 C5:1 A#4:1 C5:1  D5:0.5 D#5:0.5 F#5:0.5 D#5:0.5 D5:2  D5:4`);
  s.melody('ney', 0, m, { gain: 0.24, pan: -0.05, wet: 0.35, legato: 0.95 });
  s.melody('laud', 8, m, { gain: 0.2, pan: 0.2, wet: 0.3 });
  s.melody('ney', 8, m.map(x => ({ ...x, n: x.n !== null ? x.n + 12 : null })), { gain: 0.13, pan: -0.15, wet: 0.35, legato: 0.95 });
  return s.render(1.1, 0.13);
};

// 14) Héroe — Mi bemol mayor, 138 ppm: marcha heroica de aventura (estilo de las sagas de aventura de 16 bits; melodía original)
SONGS.heroe = () => {
  const s = new Song(138, 26);
  const A = [['D#3', 'maj'], ['A#2', 'maj'], ['C3', 'min'], ['G#2', 'maj'], ['D#3', 'maj'], ['A#2', 'maj'], ['G#2', 'maj'], ['D#3', 'maj']];
  const B = [['G#2', 'maj'], ['A#2', 'maj'], ['G2', 'min'], ['C3', 'min'], ['G#2', 'maj'], ['A#2', 'maj'], ['C3', 'maj'], ['A#2', 'maj']];
  const prog = [['D#3', 'maj'], ['A#2', 'maj'], ...A, ...B, ...A];
  prog.forEach(([r, k], bar) => { const c = chord(r, k);
    // caja de marcha: ta · ta-ta · ta · redoble
    [[0, 0.32], [1, 0.22], [1.5, 0.22], [2, 0.3]].forEach(([b, g]) => s.put(INST.caja(), s.at(bar, b), { gain: g, pan: 0.1, wet: 0.25 }));
    for (let k = 0; k < 4; k++) s.put(INST.caja(), s.at(bar, 3 + k * 0.25), { gain: 0.12 + k * 0.04, pan: 0.1, wet: 0.25 });
    for (const b of [0, 2]) s.put(INST.bombo(), s.at(bar, b), { gain: 0.55, wet: 0.1 });
    s.put(INST.timbal(64), s.at(bar), { gain: 0.35, wet: 0.35 });
    if (bar === 2 || bar === 10 || bar === 18) s.put(INST.platillo(), s.at(bar), { gain: 0.25, pan: 0.3, wet: 0.4 });
    if (bar < 2) return;
    // cuerdas en tresillos (spiccato) y colchón
    for (let k = 0; k < 12; k++) s.put(INST.cuerdas(midi([c[0], c[1], c[2]][k % 3] + 12), s.beat / 3 * 0.55), s.at(bar, k / 3), { gain: 0.055, pan: -0.35, wet: 0.25 });
    pad(s, bar, c, 4, 0.045, 0.45);
    for (const [b, n] of [[0, c[0]], [1, c[2]], [2, c[0]], [3, c[2]]]) s.put(INST.bajo(midi(n - 12), s.beat * 0.85), s.at(bar, b), { gain: 0.36, wet: 0.08 });
  });
  const melA = mel(`A#4:1 D#5:0.75 A#4:0.25 D#5:1 G5:1  F5:1.5 D5:0.5 A#4:2  C5:0.75 D5:0.25 D#5:1 G5:1 C6:1  A#5:1.5 G#5:0.5 G5:1 D#5:1
    D#5:0.75 F5:0.25 G5:1 A#5:1 D#6:1  D6:1.5 C6:0.5 A#5:2  C6:1 G#5:1 D6:1 A#5:1  D#6:3 r:1`);
  const melB = mel(`C6:1 A#5:0.5 G#5:0.5 D#5:2  D6:1 C6:0.5 A#5:0.5 F5:2  G5:0.75 G#5:0.25 A#5:1 G5:1 D5:1  D#5:1.5 D5:0.5 C5:2
    G#5:1 C6:1 D#6:1.5 D6:0.5  D6:1 A#5:1 F5:1 A#5:1  C6:1 G5:1 E5:1 G5:1  F5:1 A#5:1 D6:2`);
  s.melody('metales', 2, melA, { gain: 0.16, pan: 0.05, wet: 0.3, legato: 0.88 });
  s.melody('lider', 2, melA, { gain: 0.08, pan: -0.15, wet: 0.25, legato: 0.88 });
  s.melody('flauta', 10, melB, { gain: 0.22, pan: 0.05, wet: 0.35, legato: 0.92 });
  s.melody('cuerdas', 10, lower(melB), { gain: 0.06, pan: -0.2, wet: 0.4 });
  s.melody('metales', 18, melA, { gain: 0.15, pan: 0.05, wet: 0.3, legato: 0.88 });
  s.melody('lider', 18, melA.map(x => ({ ...x, n: x.n !== null ? x.n + 12 : null })), { gain: 0.1, pan: -0.15, wet: 0.25, legato: 0.88 });
  return s.render(1, 0.16);
};

// 15) Duelo saiyan — Fa# menor, 160 ppm, en cuatro partes que suben: grave y tensa → media → crescendo → clímax
//     (estilo de las peleas de anime de los 90; melodía original). Al repetir vuelve a lo grave: respiro antes del asalto.
SONGS.duelo_saiyan = () => {
  const s = new Song(160, 32);
  const A = [['F#3', 'min'], ['D3', 'maj'], ['E3', 'maj'], ['C#3', 'maj'], ['F#3', 'min'], ['D3', 'maj'], ['E3', 'maj'], ['C#3', 'maj']];
  const SUBE = [['B2', 'min'], ['C#3', 'min'], ['D3', 'maj'], ['E3', 'maj'], ['F#3', 'min'], ['D3', 'maj'], ['E3', 'maj'], ['C#3', 'maj']];
  const prog = [...A, ...A, ...SUBE, ...A];
  prog.forEach(([r, k], bar) => { const c = chord(r, k), root = c[0], part = Math.floor(bar / 8), inBar = bar % 8;
    const grow = part === 2 ? 0.35 + 0.75 * inBar / 7 : 1;   // en el crescendo, todo va subiendo de volumen
    if (part === 3 && inBar === 7) {   // cierre: golpe final que se deja sonar + redoble de timbal que se apaga y enlaza con la parte grave al repetir
      c.forEach(n => s.put(INST.metales(midi(n + 12), s.beat * 2.5), s.at(bar), { gain: 0.07, pan: 0.2, wet: 0.45 }));
      for (const [pan, d] of [[-0.55, 0], [0.55, 0.01]]) s.put(INST.guitarra(midi(root - 12) * (1 + d / 3), s.beat * 3), s.at(bar, d), { gain: 0.12, pan, wet: 0.2 });
      s.put(INST.bajoRock(midi(root - 24), s.beat * 3), s.at(bar), { gain: 0.3, wet: 0.05 });
      s.put(INST.bombo(), s.at(bar), { gain: 0.8, wet: 0.2 }); s.put(INST.platillo(), s.at(bar), { gain: 0.28, pan: 0.4, wet: 0.5 });
      s.put(INST.coro(midi(c[1] + 12), s.beat * 4), s.at(bar), { gain: 0.05, pan: -0.2, wet: 0.6 });
      for (let k = 0; k < 8; k++) s.put(INST.timbal(56), s.at(bar, 2 + k * 0.25), { gain: 0.4 - k * 0.03, wet: 0.4 });
      return; }
    if (part === 0) {   // grave y tensa
      s.put(INST.bajo(midi(root - 24), s.beat * 3.9), s.at(bar), { gain: 0.42, wet: 0.2 });
      s.put(INST.coro(midi(c[0] + 12), s.beat * 4), s.at(bar), { gain: 0.06, pan: -0.2, wet: 0.6 });
      s.put(INST.timbal(56), s.at(bar), { gain: 0.5, wet: 0.4 }); if (inBar % 2 === 1) s.put(INST.timbal(56), s.at(bar, 2.5), { gain: 0.3, wet: 0.4 });
      s.put(INST.bombo(), s.at(bar), { gain: 0.35, wet: 0.1 });
      s.put(INST.guitarra(midi(root - 12), s.beat * 3.5), s.at(bar), { gain: 0.05, pan: -0.5, wet: 0.3 });
      if (inBar === 7) for (let k = 0; k < 4; k++) s.put(INST.caja(), s.at(bar, 3 + k * 0.25), { gain: 0.15 + k * 0.05, wet: 0.2 });
      return; }
    // bajo en corcheas (raíz / octava en el clímax)
    for (let k2 = 0; k2 < 8; k2++) s.put(INST.bajoRock(midi(part === 3 && k2 % 2 ? root - 12 : root - 24), s.beat * 0.42), s.at(bar, k2 * 0.5), { gain: 0.3 * (part === 1 ? 0.8 : grow), wet: 0.03 });
    if (part === 1) {   // media: batería a medio tiempo, guitarra en sordina, metales sueltos
      for (const b of [0, 2.5]) s.put(INST.bombo(), s.at(bar, b), { gain: 0.6, wet: 0.06 });
      s.put(INST.caja(), s.at(bar, 2), { gain: 0.4, wet: 0.25 });
      for (let k2 = 0; k2 < 4; k2++) s.put(INST.charles(), s.at(bar, k2), { gain: 0.12, pan: -0.35, wet: 0.08 });
      for (let k2 = 0; k2 < 8; k2++) s.put(INST.guitarra(midi(root - 12), s.beat * 0.22, { mute: true }), s.at(bar, k2 * 0.5), { gain: 0.08, pan: k2 % 2 ? 0.5 : -0.5, wet: 0.08 });
      if (inBar % 2 === 0) c.forEach(n => s.put(INST.metales(midi(n + 12), s.beat * 0.6), s.at(bar), { gain: 0.05, pan: 0.2, wet: 0.3 }));
      pad(s, bar, c, 4, 0.035, 0.45);
      return; }
    // crescendo y clímax: guitarra en semicorcheas con acentos, metales en contratiempo
    for (let k2 = 0; k2 < 16; k2++) { const acc = [0, 3, 6, 9, 12].includes(k2);
      for (const [pan, d] of [[-0.55, 0], [0.55, 0.01]]) s.put(INST.guitarra(midi(root - 12) * (1 + d / 3), s.beat * (acc ? 0.45 : 0.2), { mute: !acc }), s.at(bar, k2 * 0.25 + d), { gain: (acc ? 0.12 : 0.07) * grow, pan, wet: 0.08 }); }
    for (const b of [0.5, 1.5, 2.5, 3.5]) c.forEach(n => s.put(INST.metales(midi(n + 12), s.beat * 0.35), s.at(bar, b), { gain: 0.045 * grow, pan: 0.2, wet: 0.25 }));
    s.put(INST.coro(midi(c[1] + 12), s.beat * 4), s.at(bar), { gain: 0.05 * grow, pan: -0.2, wet: 0.5 });
    if (part === 2) {   // la caja va acelerando: negras → corcheas → semicorcheas → redoble
      for (const b of [0, 2]) s.put(INST.bombo(), s.at(bar, b), { gain: 0.7 * grow, wet: 0.05 });
      const step = inBar < 2 ? 1 : inBar < 4 ? 0.5 : inBar < 6 ? 0.25 : 0.125;
      for (let b = 0; b < 4; b += step) s.put(INST.caja(), s.at(bar, b), { gain: (0.18 + 0.25 * (inBar / 7) + 0.05 * (b / 4)) * (step < 0.5 ? 0.8 : 1), pan: 0.05, wet: 0.22 });
      for (let k2 = 0; k2 < 8; k2++) s.put(INST.charles(), s.at(bar, k2 * 0.5), { gain: 0.1 * grow, pan: -0.35, wet: 0.08 });
      if (inBar === 0) s.put(INST.platillo(), s.at(bar), { gain: 0.15, pan: 0.4, wet: 0.35 });
      return; }
    // clímax
    rockDrums(s, bar, { dbl: true, crash: inBar % 4 === 0 });
  });
  const grave = mel(`F#4:2 A4:2  F#4:3 E4:1  E4:2 G#4:2  F4:4  F#4:1 A4:1 C#5:2  D5:2 A4:2  B4:2 G#4:1 E4:1  F4:4`);
  const melA = mel(`C#5:1.5 F#5:0.5 A5:1 G#5:1  F#5:2 E5:1 D5:1  E5:1 G#5:1 B5:1.5 A5:0.5  G#5:2 F5:1 C#5:1
    F#5:1 A5:1 C#6:1.5 B5:0.5  A5:1 F#5:1 D5:1 F#5:1  G#5:1 B5:1 E6:1 D6:0.5 C#6:0.5  C#6:3 r:1`);
  const sube = mel(`B4:1 D5:1 F#5:2  C#5:1 E5:1 G#5:2  D5:1 F#5:1 A5:2  E5:1 G#5:1 B5:2
    F#5:1 A5:1 C#6:2  D6:1 C#6:1 A5:2  E6:1 D6:1 B5:2  C#6:4`);
  s.melody('cuerdas', 0, grave, { gain: 0.13, pan: -0.1, wet: 0.4 });
  s.melody('metales', 0, lower(grave), { gain: 0.09, pan: 0.15, wet: 0.35, legato: 0.95 });
  s.melody('lider', 8, lower(melA), { gain: 0.18, pan: 0.1, wet: 0.25, legato: 0.92, glide: true });
  s.melody('metales', 8, lower(melA, 24), { gain: 0.06, pan: -0.2, wet: 0.3 });
  s.melody('lider', 16, sube.slice(0, 12), { gain: 0.15, pan: 0.1, wet: 0.25, legato: 0.92, glide: true });
  s.melody('lider', 20, sube.slice(12), { gain: 0.21, pan: 0.1, wet: 0.25, legato: 0.92, glide: true });
  s.melody('cuerdas', 16, lower(sube), { gain: 0.07, pan: -0.25, wet: 0.4 });
  s.melody('lider', 24, melA, { gain: 0.2, pan: 0.1, wet: 0.25, legato: 0.92, glide: true });
  s.melody('lider', 24, melA.map(x => ({ ...x, n: x.n !== null ? x.n + 12 : null })), { gain: 0.07, pan: -0.25, wet: 0.25, legato: 0.92 });
  s.melody('metales', 24, melA, { gain: 0.1, pan: -0.15, wet: 0.3 });
  return s.render(0.85, 0.16);
};

// ── Escritura ──────────────────────────────────────────────────────────────
function writeWav(file, L, R) {
  const n = L.length, out = Buffer.alloc(44 + n * 4);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 4, 4); out.write('WAVE', 8); out.write('fmt ', 12); out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4); out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4); }
  fs.writeFileSync(file, out);
}
fs.mkdirSync(outRoot, { recursive: true });
for (const [name, fn] of Object.entries(SONGS)) {
  if (only.length && !only.includes(name)) continue;
  seed = 1000 + name.length;
  const t0 = Date.now(); const [L, R] = fn();
  const wav = path.join(outRoot, name + '.wav'); writeWav(wav, L, R);
  for (const [ext, args] of [['ogg', ['-c:a', 'libvorbis', '-q:a', '5']], ['mp3', ['-c:a', 'libmp3lame', '-b:a', '160k']]])
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', wav, ...args, path.join(outRoot, `${name}.${ext}`)]);
  console.log(`${name}: ${(L.length / SR).toFixed(1)} s · ${((Date.now() - t0) / 1000).toFixed(1)} s de render`);
}
