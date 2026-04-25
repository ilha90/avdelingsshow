// effects.js — live-energi-effekter for host-skjermen.
// scoreDelta, toasts, combos, halos, rank-animasjoner.

let toastHost = null;
let deltaHost = null;

function ensureHosts(){
  if (!toastHost){
    toastHost = document.createElement('div');
    toastHost.id = 'toast-host';
    toastHost.className = 'toast-host';
    document.body.appendChild(toastHost);
  }
  if (!deltaHost){
    deltaHost = document.createElement('div');
    deltaHost.id = 'delta-host';
    deltaHost.className = 'delta-host';
    document.body.appendChild(deltaHost);
  }
}

// ====== Score-delta — flyt tall opp fra (x,y) ======
export function scoreDeltaAt(x, y, value, opts = {}){
  ensureHosts();
  const el = document.createElement('div');
  el.className = 'score-delta' + (value < 0 ? ' neg' : '');
  if (opts.gold) el.classList.add('gold');
  el.textContent = (value > 0 ? '+' : '') + value;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  deltaHost.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// Bekvem — finn DOM-elementet til en spiller og spawn delta over det
export function scoreDeltaOnPlayer(playerId, value, opts){
  const el = document.querySelector(`[data-pid="${playerId}"]`);
  if (!el) return;
  const r = el.getBoundingClientRect();
  scoreDeltaAt(r.left + r.width / 2, r.top + r.height * 0.3, value, opts);
}

// ====== Toasts ======
export function toast(text, opts = {}){
  ensureHosts();
  const el = document.createElement('div');
  el.className = 'live-toast' + (opts.kind ? ' t-' + opts.kind : '');
  if (opts.icon){
    el.innerHTML = `<span class="ti">${opts.icon}</span><span class="tt">${escapeHtml(text)}</span>`;
  } else {
    el.textContent = text;
  }
  toastHost.appendChild(el);
  // stagger stack
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, opts.ms || 3200);
}

export function joinToast(name, emoji){
  toast(`${name} ble med!`, { icon: emoji || '🎉', kind: 'join' });
}

export function firstAnswerToast(name){
  toast(`${name} — først ute! +100`, { icon: '⚡', kind: 'first' });
}

export function streakToast(name, n){
  toast(`${name} — ${n} på rad!`, { icon: '🔥', kind: 'streak' });
}

export function ko(name){
  toast(`K.O. — ${name}`, { icon: '💥', kind: 'ko', ms: 2500 });
}

// ====== First-answer halo på spiller-kort ======
export function halo(playerId, color = 'mint'){
  const el = document.querySelector(`[data-pid="${playerId}"]`);
  if (!el) return;
  el.classList.remove('halo-mint', 'halo-gold', 'halo-danger');
  void el.offsetWidth;
  el.classList.add('halo-' + color);
  setTimeout(() => el.classList.remove('halo-' + color), 1400);
}

// ====== Rank-animasjon: flash crown ved lederbytte ======
let lastLeader = null;
export function updateLeader(playerId){
  if (playerId === lastLeader) return;
  lastLeader = playerId;
  if (!playerId) return;
  const el = document.querySelector(`[data-pid="${playerId}"]`);
  if (!el) return;
  el.classList.remove('crown-flash');
  void el.offsetWidth;
  el.classList.add('crown-flash');
  setTimeout(() => el.classList.remove('crown-flash'), 1600);
}

// ====== Has-answered puls ======
export function flashAnswered(playerId){
  const el = document.querySelector(`[data-pid="${playerId}"]`);
  if (!el) return;
  el.classList.add('answered');
  setTimeout(() => el.classList.remove('answered'), 3000);
}

export function clearAnswered(){
  document.querySelectorAll('.player-card.answered').forEach(el => el.classList.remove('answered'));
}

// ====== Phase transition banner (kort, kraftig) ======
export function phaseBanner(text, subtitle){
  ensureHosts();
  const el = document.createElement('div');
  el.className = 'phase-banner';
  el.innerHTML = `<div class="pb-title">${escapeHtml(text)}</div>${subtitle ? `<div class="pb-sub">${escapeHtml(subtitle)}</div>` : ''}`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in'); el.classList.add('out');
    setTimeout(() => el.remove(), 500);
  }, 1800);
}

// ====== Floating emoji burst (generisk) ======
export function emojiBurst(emoji, x, y, count = 6){
  ensureHosts();
  for (let i = 0; i < count; i++){
    const el = document.createElement('div');
    el.className = 'emoji-burst';
    el.textContent = emoji;
    el.style.left = (x + (Math.random() - 0.5) * 30) + 'px';
    el.style.top = (y + (Math.random() - 0.5) * 30) + 'px';
    el.style.setProperty('--dx', ((Math.random() - 0.5) * 200) + 'px');
    el.style.setProperty('--dy', (-120 - Math.random() * 150) + 'px');
    el.style.setProperty('--rot', ((Math.random() - 0.5) * 360) + 'deg');
    el.style.animationDelay = (i * 40) + 'ms';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }
}

function escapeHtml(s){
  return String(s || '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' })[ch]);
}
