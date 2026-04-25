// stage-bg.js — generativ 2D canvas-bakgrunn for host-storskjerm.
// Lett: <200 partikler, render-on-demand ville vært overkill (animert flow).
// Lytter til window event 'stage:boom' for puls-effekter.

const CFG = {
  particles: 120,
  maxVel: 0.35,
  connectDist: 140,
  hue: 158,          // mynte-grønn
  goldHue: 44,
};

let canvas, ctx, W, H, DPR;
let particles = [];
let pulses = [];   // { x, y, born, color, strength }
let mouseX = 0.5, mouseY = 0.5;
let running = true;
let lastBoom = 0;

export function start(target){
  canvas = target || document.getElementById('stage-bg');
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('mousemove', onMouse, { passive: true });
  window.addEventListener('stage:boom', onBoom);
  seed();
  loop();
}

function resize(){
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function onMouse(e){
  mouseX = e.clientX / W;
  mouseY = e.clientY / H;
}

function onBoom(e){
  const d = e.detail || {};
  const now = performance.now();
  if (now - lastBoom < 80) return;
  lastBoom = now;
  pulses.push({
    x: d.x ?? W/2,
    y: d.y ?? H/2,
    born: now,
    color: d.color || 'mint',
    strength: d.strength || 1
  });
  // Kick partikler fra senter
  for (const p of particles){
    const dx = p.x - (d.x ?? W/2);
    const dy = p.y - (d.y ?? H/2);
    const dist = Math.hypot(dx, dy) || 1;
    const push = Math.min(4, 400 / dist) * (d.strength || 1);
    p.vx += (dx / dist) * push;
    p.vy += (dy / dist) * push;
  }
}

function seed(){
  particles = [];
  for (let i = 0; i < CFG.particles; i++){
    particles.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * CFG.maxVel,
      vy: (Math.random() - 0.5) * CFG.maxVel,
      r: 0.8 + Math.random() * 2.4,
      hueOffset: (Math.random() - 0.5) * 40,
      life: Math.random()
    });
  }
}

function loop(){
  if (!running) return;
  requestAnimationFrame(loop);

  // Bakgrunn — vi MÅ tegne bakgrunnen (clearRect ville vist kropp bak)
  const g = ctx.createRadialGradient(W * mouseX, H * mouseY, 0, W/2, H/2, Math.max(W, H) * 0.85);
  g.addColorStop(0, 'rgba(16,50,36,.95)');
  g.addColorStop(0.4, 'rgba(8,28,20,.98)');
  g.addColorStop(1, 'rgba(2,14,10,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Subtil vignett + støy
  ctx.fillStyle = 'rgba(0,0,0,.14)';
  ctx.fillRect(0, 0, W, H);

  const now = performance.now();

  // Puls-ringer
  for (let i = pulses.length - 1; i >= 0; i--){
    const p = pulses[i];
    const age = (now - p.born) / 1000;
    if (age > 1.8){ pulses.splice(i, 1); continue; }
    const r = age * 700 * p.strength;
    const op = Math.max(0, 0.45 - age * 0.25) * p.strength;
    const color = p.color === 'gold'
      ? `hsla(${CFG.goldHue}, 75%, 58%, ${op})`
      : `hsla(${CFG.hue}, 70%, 60%, ${op})`;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 + p.strength * 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Oppdater partikler
  for (const p of particles){
    p.life = (p.life + 0.0016) % 1;
    p.x += p.vx;
    p.y += p.vy;
    // Mild venndring mot musen
    const dx = (W * mouseX) - p.x, dy = (H * mouseY) - p.y;
    const dist2 = dx*dx + dy*dy;
    if (dist2 < 40000){
      p.vx += dx * 0.000005;
      p.vy += dy * 0.000005;
    }
    // Demping
    p.vx *= 0.985; p.vy *= 0.985;
    // Min-velocity for liv
    const v = Math.hypot(p.vx, p.vy);
    if (v < 0.05){
      p.vx += (Math.random() - 0.5) * 0.1;
      p.vy += (Math.random() - 0.5) * 0.1;
    }
    // Wrap
    if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10;
    if (p.y < -10) p.y = H + 10; if (p.y > H + 10) p.y = -10;
  }

  // Forbindelseslinjer (nær-nabo)
  ctx.lineWidth = 1;
  for (let i = 0; i < particles.length; i++){
    const a = particles[i];
    for (let j = i + 1; j < particles.length; j++){
      const b = particles[j];
      const dx = a.x - b.x, dy = a.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d < CFG.connectDist){
        const op = (1 - d / CFG.connectDist) * 0.22;
        ctx.strokeStyle = `hsla(${CFG.hue + a.hueOffset}, 65%, 55%, ${op})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  // Partikler
  for (const p of particles){
    const glow = 0.5 + 0.5 * Math.sin(p.life * Math.PI * 2);
    ctx.fillStyle = `hsla(${CFG.hue + p.hueOffset}, 75%, ${55 + glow * 15}%, ${0.5 + glow * 0.4})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r + glow * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Gull-aksent streaks (få, rolig)
  const t = now * 0.00008;
  ctx.strokeStyle = `hsla(${CFG.goldHue}, 70%, 58%, .06)`;
  ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++){
    ctx.beginPath();
    const y = H * (0.2 + k * 0.3) + Math.sin(t + k) * 40;
    ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 40){
      ctx.lineTo(x, y + Math.sin((x * 0.004) + t * 6 + k) * 30);
    }
    ctx.stroke();
  }
}

export function stop(){ running = false; }

// Utility — exposed på window for debugging + enkel trigging
export function boom(x, y, color = 'mint', strength = 1){
  window.dispatchEvent(new CustomEvent('stage:boom', { detail: { x, y, color, strength } }));
}
