// sound.js — Lydeffekter via WebAudio (ingen filer, generert i browser)
let ctx = null;
let enabled = JSON.parse(localStorage.getItem('sound-on') ?? 'true');

function ensureCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, type = 'sine', vol = 0.2, attack = 0.005, release = 0.08) {
  if (!enabled) return;
  const c = ensureCtx();
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + release);
}

function chord(freqs, dur, type = 'sine', vol = 0.15) {
  freqs.forEach(f => tone(f, dur, type, vol));
}

export const sfx = {
  tick:    () => tone(880, 0.04, 'square', 0.06),
  tock:    () => tone(660, 0.04, 'square', 0.06),
  correct: () => {
    chord([523, 659, 784], 0.35, 'triangle', 0.14);  // C E G
    setTimeout(() => chord([659, 784, 988], 0.45, 'triangle', 0.14), 120);
  },
  wrong:   () => {
    tone(200, 0.2, 'sawtooth', 0.15);
    setTimeout(() => tone(150, 0.4, 'sawtooth', 0.13), 100);
  },
  join:    () => { tone(800, 0.08, 'sine', 0.12); setTimeout(() => tone(1200, 0.1, 'sine', 0.1), 60); },
  countdown: () => tone(1200, 0.08, 'square', 0.12),
  final:   () => tone(400, 0.15, 'square', 0.1),
  applause: () => {
    // Cheering — simulated with lots of tones
    for (let i = 0; i < 20; i++) {
      setTimeout(() => tone(400 + Math.random() * 800, 0.15, 'triangle', 0.05), i * 40);
    }
  },
  fanfare: () => {
    const t = [523, 659, 784, 1047];
    t.forEach((f, i) => setTimeout(() => chord([f, f * 1.5], 0.25, 'triangle', 0.15), i * 150));
  },
  spin:    () => {
    let freq = 200;
    const start = performance.now();
    const iv = setInterval(() => {
      const elapsed = performance.now() - start;
      if (elapsed > 4500) { clearInterval(iv); return; }
      tone(freq, 0.04, 'square', 0.08);
      freq = Math.max(100, 400 - elapsed / 15);
    }, 80);
  },
  reveal:  () => chord([440, 554], 0.4, 'triangle', 0.12),
  drumroll: () => {
    // Rapid low tones building up
    const start = performance.now();
    const iv = setInterval(() => {
      const elapsed = performance.now() - start;
      if (elapsed > 1200) { clearInterval(iv); return; }
      const intensity = 0.05 + (elapsed / 1200) * 0.1;
      tone(80 + Math.random() * 40, 0.04, 'sawtooth', intensity);
    }, 30);
  },
};

window.sfx = sfx;

const toggleBtn = document.getElementById('soundToggle');
if (toggleBtn) {
  toggleBtn.textContent = enabled ? '🔊' : '🔇';
  toggleBtn.addEventListener('click', () => {
    enabled = !enabled;
    localStorage.setItem('sound-on', JSON.stringify(enabled));
    toggleBtn.textContent = enabled ? '🔊' : '🔇';
    if (enabled) tone(600, 0.1, 'sine', 0.15);
  });
}

// Ensure audio unlocks on first user gesture
document.addEventListener('click', () => ensureCtx(), { once: true });
