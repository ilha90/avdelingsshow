// === AVDELINGSSHOW — EFFECTS: LYD, KONFETTI, FULLSKJERM ===
'use strict';

// ============================================================
// LYDMOTOR (Web Audio — ingen filer nødvendig)
// ============================================================
const Sound = (() => {
  let ctx = null;
  let muted = localStorage.getItem('show-muted') === '1';
  let masterGain = null;

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.35;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function tone({ freq = 440, type = 'sine', duration = 0.15, attack = 0.005, release = 0.1, vol = 0.3, detune = 0, when = 0 }) {
    if (muted) return;
    ensureCtx();
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    if (detune) osc.detune.value = detune;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + attack);
    gain.gain.setValueAtTime(vol, t + Math.max(attack, duration - release));
    gain.gain.linearRampToValueAtTime(0, t + duration);
    osc.connect(gain).connect(masterGain);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  function sweep({ from, to, duration = 0.4, type = 'sawtooth', vol = 0.2 }) {
    if (muted) return;
    ensureCtx();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(masterGain);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  function noise({ duration = 0.2, vol = 0.15, filterFreq = 1000 }) {
    if (muted) return;
    ensureCtx();
    const t = ctx.currentTime;
    const bufSize = ctx.sampleRate * duration;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(masterGain);
    src.start(t);
    src.stop(t + duration);
  }

  return {
    init: ensureCtx,
    toggleMute() {
      muted = !muted;
      localStorage.setItem('show-muted', muted ? '1' : '0');
      return muted;
    },
    isMuted: () => muted,

    click() { tone({ freq: 800, type: 'square', duration: 0.05, vol: 0.12 }); },
    hover() { tone({ freq: 1200, type: 'sine', duration: 0.04, vol: 0.06 }); },

    correct() {
      tone({ freq: 523.25, type: 'triangle', duration: 0.12, vol: 0.25, when: 0 });
      tone({ freq: 659.25, type: 'triangle', duration: 0.12, vol: 0.25, when: 0.1 });
      tone({ freq: 783.99, type: 'triangle', duration: 0.25, vol: 0.28, when: 0.2 });
    },

    wrong() {
      tone({ freq: 200, type: 'sawtooth', duration: 0.3, vol: 0.2 });
      tone({ freq: 150, type: 'sawtooth', duration: 0.3, vol: 0.2, when: 0.05 });
    },

    tick() { tone({ freq: 1800, type: 'square', duration: 0.025, vol: 0.08 }); },

    countdown() { tone({ freq: 880, type: 'sine', duration: 0.18, vol: 0.3 }); },

    go() {
      tone({ freq: 440, type: 'triangle', duration: 0.12, vol: 0.3, when: 0 });
      tone({ freq: 554.37, type: 'triangle', duration: 0.12, vol: 0.3, when: 0.08 });
      tone({ freq: 659.25, type: 'triangle', duration: 0.4, vol: 0.32, when: 0.16 });
    },

    buzzer() {
      sweep({ from: 400, to: 100, duration: 0.8, type: 'sawtooth', vol: 0.25 });
      sweep({ from: 380, to: 90, duration: 0.8, type: 'square', vol: 0.15 });
    },

    fanfare() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        tone({ freq: f, type: 'triangle', duration: 0.15, vol: 0.28, when: i * 0.09 });
      });
      tone({ freq: 1046.5, type: 'triangle', duration: 0.5, vol: 0.3, when: 0.45 });
      tone({ freq: 1318.5, type: 'triangle', duration: 0.5, vol: 0.25, when: 0.45 });
    },

    wheelTick() { tone({ freq: 1600, type: 'triangle', duration: 0.03, vol: 0.14 }); },

    wheelLand() {
      tone({ freq: 523.25, type: 'triangle', duration: 0.08, vol: 0.22, when: 0 });
      tone({ freq: 783.99, type: 'triangle', duration: 0.3, vol: 0.25, when: 0.07 });
    },

    flip() { noise({ duration: 0.15, vol: 0.08, filterFreq: 2000 }); },

    whoosh() { sweep({ from: 200, to: 1200, duration: 0.3, type: 'sine', vol: 0.1 }); },

    streak() {
      [659.25, 783.99, 987.77, 1318.5].forEach((f, i) => {
        tone({ freq: f, type: 'triangle', duration: 0.08, vol: 0.22, when: i * 0.05 });
      });
    }
  };
})();

// ============================================================
// KONFETTI
// ============================================================
const Confetti = (() => {
  let canvas, ctx, particles = [], running = false;
  const COLORS = ['#d4af37', '#e94560', '#4ecdc4', '#9b59ff', '#f39c12', '#2ecc71', '#3498db', '#fff5c8'];

  function init() {
    canvas = document.getElementById('confetti-canvas');
    ctx = canvas.getContext('2d');
    resize();
    addEventListener('resize', resize);
  }
  function resize() {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
  }

  function burst({ x = innerWidth / 2, y = innerHeight / 2, count = 120, spread = Math.PI * 2, power = 14 } = {}) {
    if (!canvas) init();
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
      const speed = power * (0.5 + Math.random() * 0.8);
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 8,
        h: 8 + Math.random() * 10,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 1,
        shape: Math.random() < 0.4 ? 'circle' : 'rect'
      });
    }
    if (!running) loop();
  }

  function cannons() {
    burst({ x: innerWidth * 0.15, y: innerHeight * 0.8, count: 80, spread: Math.PI * 0.6, power: 18 });
    burst({ x: innerWidth * 0.85, y: innerHeight * 0.8, count: 80, spread: Math.PI * 0.6, power: 18 });
    setTimeout(() => {
      burst({ x: innerWidth * 0.3, y: innerHeight * 0.9, count: 60, spread: Math.PI * 0.5, power: 16 });
      burst({ x: innerWidth * 0.7, y: innerHeight * 0.9, count: 60, spread: Math.PI * 0.5, power: 16 });
    }, 300);
    setTimeout(() => {
      burst({ x: innerWidth * 0.5, y: innerHeight * 0.9, count: 120, spread: Math.PI * 0.8, power: 22 });
    }, 600);
  }

  function loop() {
    running = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const gravity = 0.35;
    const drag = 0.992;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += gravity;
      p.vx *= drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= 0.004;
      if (p.life <= 0 || p.y > canvas.height + 40) {
        particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.2));
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    if (particles.length > 0) {
      requestAnimationFrame(loop);
    } else {
      running = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  return { burst, cannons, init };
})();

// ============================================================
// FULLSKJERM
// ============================================================
const Fullscreen = {
  toggle() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }
};

// ============================================================
// FLASH OVERLAY (CORRECT / WRONG)
// ============================================================
function flashOverlay(text, kind) {
  const div = document.createElement('div');
  div.className = 'flash-overlay flash-' + kind;
  div.textContent = text;
  document.body.appendChild(div);
  requestAnimationFrame(() => div.classList.add('show'));
  setTimeout(() => {
    div.classList.remove('show');
    setTimeout(() => div.remove(), 300);
  }, 900);
}

function screenShake(ms = 400) {
  document.body.classList.add('screen-shake');
  setTimeout(() => document.body.classList.remove('screen-shake'), ms);
}

// ============================================================
// CURTAIN TRANSITION
// ============================================================
function curtainTransition(cb) {
  const left = document.getElementById('curtain-left');
  const right = document.getElementById('curtain-right');
  if (!left || !right) { cb && cb(); return; }
  Sound.whoosh();
  left.classList.add('close');
  right.classList.add('close');
  setTimeout(() => {
    cb && cb();
    setTimeout(() => {
      left.classList.remove('close');
      right.classList.remove('close');
    }, 80);
  }, 450);
}

// ============================================================
// ANIMERT TELLER (counts up to target)
// ============================================================
function animateCounter(el, from, to, duration = 600) {
  const start = performance.now();
  function frame(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = Math.round(from + (to - from) * eased);
    el.textContent = val;
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Gjør noen klikk-lyder universelt
document.addEventListener('click', (e) => {
  if (e.target.closest('.game-card')) Sound.whoosh();
  else if (e.target.closest('.btn') || e.target.closest('.pill-btn')) Sound.click();
}, true);
