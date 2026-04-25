// public/sound.js — Web Audio-sfx med chords + ambient bed
let ctx = null;
let muted = false;
let master = null;
let sfxBus = null;
let musicBus = null;
let ambient = null; // { osc, gain }

export function setMuted(v){
  muted = !!v;
  if (master) master.gain.value = muted ? 0 : 1;
}
export function isMuted(){ return muted; }

function ensure(){
  if (muted) return null;
  if (!ctx){
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e){ return null; }
    master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.5; musicBus.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(()=>{});
  return ctx;
}

function tone(freq, dur, type='sine', gain=0.15, bus=null){
  const c = ensure(); if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(gain, c.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g); g.connect(bus || sfxBus);
  o.start();
  o.stop(c.currentTime + dur + 0.02);
}

function chord(freqs, dur, type='sine', gain=0.12){
  for (const f of freqs) tone(f, dur, type, gain);
}

function arpeggio(freqs, stepMs = 80, dur = 0.18, type='triangle', gain=0.18){
  freqs.forEach((f, i) => setTimeout(() => tone(f, dur, type, gain), i * stepMs));
}

function noise(dur, gain=0.2, filterFreq=800){
  const c = ensure(); if (!c) return;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate*dur), c.sampleRate);
  const arr = buf.getChannelData(0);
  for (let i=0;i<arr.length;i++) arr[i] = (Math.random()*2 - 1);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=filterFreq;
  const g = c.createGain(); g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  src.connect(f); f.connect(g); g.connect(sfxBus);
  src.start();
}

// Noter (Hz). C major pentatonic.
const NOTES = {
  C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.00, A4: 440.00,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.00,
  C6: 1046.50, D6: 1174.66, E6: 1318.51, G6: 1567.98,
  Eb4: 311.13, F4: 349.23, Ab4: 415.30, Bb4: 466.16
};

export const sfx = {
  tick(){ tone(1200, 0.04, 'square', 0.06); },
  countdown(){ tone(880, 0.08, 'triangle', 0.22); tone(660, 0.08, 'sine', 0.12); },
  go(){ chord([NOTES.C5, NOTES.E5, NOTES.G5], 0.3, 'sawtooth', 0.16); },
  // CORRECT — C-E-G major arpeggio (glad)
  correct(){ arpeggio([NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6], 60, 0.22, 'triangle', 0.18); },
  // WRONG — dissonant minor descending
  wrong(){ tone(NOTES.Eb4, 0.12, 'sawtooth', 0.18); setTimeout(() => tone(NOTES.C4, 0.22, 'sawtooth', 0.16), 100); },
  // JOIN — oppover pentatonic splash
  join(){ arpeggio([NOTES.G4, NOTES.C5, NOTES.E5, NOTES.G5], 50, 0.18, 'sine', 0.14); },
  pop(){ tone(540, 0.06, 'triangle', 0.14); },
  whoosh(){ noise(0.28, 0.22, 1400); },
  bomb(){ noise(0.5, 0.4, 350); },
  boom(){
    noise(0.75, 0.55, 180);
    tone(72, 0.7, 'sawtooth', 0.32);
    setTimeout(() => tone(52, 0.5, 'sawtooth', 0.24), 60);
    setTimeout(() => tone(38, 0.4, 'square', 0.18), 120);
  },
  // REVEAL — rolig oppadstigende
  reveal(){ arpeggio([NOTES.G4, NOTES.C5, NOTES.E5], 90, 0.2, 'sine', 0.2); },
  // BIG WIN — mer dramatisk arpeggio over oktaver
  bigWin(){
    arpeggio([NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6, NOTES.E6, NOTES.G6], 75, 0.22, 'triangle', 0.2);
    setTimeout(() => chord([NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6], 1.2, 'sine', 0.08), 500);
  },
  buttonDown(){ tone(380, 0.04, 'square', 0.06); },
  shield(){ chord([NOTES.A4, NOTES.C5, NOTES.E5], 0.25, 'sine', 0.15); },
  pickup(){ tone(NOTES.C5, 0.06, 'sine', 0.12); setTimeout(() => tone(NOTES.E5, 0.06, 'sine', 0.12), 40); setTimeout(() => tone(NOTES.G5, 0.1, 'triangle', 0.14), 80); },
  // STREAK — økende intensitet
  streak(n){ const base = NOTES.C5; const steps = Math.min(n, 5); const notes = [base]; for (let i = 1; i < steps; i++) notes.push(base * (1 + i * 0.25)); arpeggio(notes, 50, 0.16, 'square', 0.16); },

  // ===== NYE WOW-LYDER =====
  // Trommevirvel — rask noise med pitch-modulation
  drumroll(ms = 900){
    const c = ensure(); if (!c) return;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * ms/1000), c.sampleRate);
    const arr = buf.getChannelData(0);
    for (let i = 0; i < arr.length; i++){
      const t = i / c.sampleRate;
      // Tempo akselererer mot slutt
      const tempo = 8 + t * 22;
      const env = 0.4 + 0.4 * Math.abs(Math.sin(t * tempo * Math.PI));
      arr[i] = (Math.random() * 2 - 1) * env * 0.55;
    }
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = c.createGain(); g.gain.value = 0.28;
    g.gain.setValueAtTime(0.28, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.9, c.currentTime + ms/1000);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start();
  },
  // Hjerteslag — lubb-dubb
  heartbeat(){
    tone(55, 0.07, 'sine', 0.25);
    setTimeout(() => tone(48, 0.12, 'sine', 0.22), 130);
  },
  // Siren — opp-ned-sveip
  siren(){
    const c = ensure(); if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square'; o.frequency.value = 600;
    o.frequency.linearRampToValueAtTime(420, c.currentTime + 0.3);
    o.frequency.linearRampToValueAtTime(600, c.currentTime + 0.6);
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.12, c.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.6);
    o.connect(g); g.connect(sfxBus);
    o.start(); o.stop(c.currentTime + 0.62);
  },
  // Wheel-tick (klang med pitch)
  wheelTick(pitch = 1){
    tone(800 * pitch, 0.04, 'square', 0.09);
    tone(1600 * pitch, 0.03, 'sine', 0.04);
  },
  // Fanfare — end-screen-horn
  fanfare(){
    const seq = [[NOTES.C5, 0.15], [NOTES.C5, 0.12], [NOTES.C5, 0.12], [NOTES.E5, 0.4]];
    let t = 0;
    for (const [f, dur] of seq){
      setTimeout(() => chord([f, f*1.26, f*1.5], dur, 'sawtooth', 0.18), t * 1000);
      t += dur + 0.04;
    }
    setTimeout(() => chord([NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6, NOTES.E6], 1.6, 'triangle', 0.14), (t + 0.08) * 1000);
  },
  // Zoom-whoosh — for intro-kort
  zoom(){
    const c = ensure(); if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine'; o.frequency.value = 180;
    o.frequency.exponentialRampToValueAtTime(2400, c.currentTime + 0.25);
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.18, c.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.28);
    o.connect(g); g.connect(sfxBus);
    o.start(); o.stop(c.currentTime + 0.3);
  },
  // Lightning — elektrisk knitring
  lightning(){
    noise(0.25, 0.4, 3000);
    tone(120, 0.18, 'sawtooth', 0.22);
    setTimeout(() => noise(0.15, 0.32, 4200), 60);
  },
  // Spotlight — mykt glissando
  spotlight(){
    const c = ensure(); if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle'; o.frequency.value = NOTES.C5;
    o.frequency.linearRampToValueAtTime(NOTES.G5, c.currentTime + 0.4);
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.12, c.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.5);
    o.connect(g); g.connect(sfxBus);
    o.start(); o.stop(c.currentTime + 0.52);
  },
  // Tick-up (score-roll)
  tickUp(i){
    tone(900 + i * 40, 0.03, 'square', 0.05);
  }
};

// ===== Ambient bed =====
// Fortykket drone som kan slås på/av. Mykt LFO for bevegelse.
export function startAmbient(){
  const c = ensure(); if (!c || ambient) return;
  const osc1 = c.createOscillator(); osc1.type = 'sine'; osc1.frequency.value = 110;
  const osc2 = c.createOscillator(); osc2.type = 'sine'; osc2.frequency.value = 165; // Fifth
  const osc3 = c.createOscillator(); osc3.type = 'triangle'; osc3.frequency.value = 82;
  const lfo = c.createOscillator(); lfo.frequency.value = 0.12;
  const lfoGain = c.createGain(); lfoGain.gain.value = 8;
  lfo.connect(lfoGain).connect(osc1.frequency);
  const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 800; filter.Q.value = 0.8;
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.gain.linearRampToValueAtTime(0.05, c.currentTime + 2);
  osc1.connect(filter); osc2.connect(filter); osc3.connect(filter);
  filter.connect(gain); gain.connect(musicBus);
  osc1.start(); osc2.start(); osc3.start(); lfo.start();
  ambient = { osc1, osc2, osc3, lfo, gain, filter };
}

export function stopAmbient(){
  if (!ambient || !ctx) return;
  const g = ambient.gain;
  g.gain.cancelScheduledValues(ctx.currentTime);
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
  setTimeout(() => {
    try { ambient.osc1.stop(); ambient.osc2.stop(); ambient.osc3.stop(); ambient.lfo.stop(); } catch(e) {}
    ambient = null;
  }, 1600);
}

// Unlock audio on first user interaction
export function unlock(){
  if (!muted) ensure();
}
document.addEventListener('pointerdown', unlock, { once: true, passive: true });
document.addEventListener('keydown', unlock, { once: true });
