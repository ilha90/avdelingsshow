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

// ============================================================
// WOW: Cinematic building blocks
// ============================================================

// ----- Question intro card -----
// Blar inn et kategori-kort før hvert quiz-spørsmål.
export function questionIntro({ index, total, categoryLabel, categoryEmoji, durationMs = 1400 }){
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'intro-card';
    el.innerHTML = `
      <div class="intro-tag">Spørsmål</div>
      <div class="intro-num">${index} <span class="intro-sep">/</span> <span class="intro-total">${total}</span></div>
      <div class="intro-cat"><span class="intro-cat-emoji">${categoryEmoji || '🧠'}</span><span class="intro-cat-label">${escapeHtml(categoryLabel || 'Quiz')}</span></div>
      <div class="intro-beam"></div>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in'); el.classList.add('out');
      setTimeout(() => { el.remove(); resolve(); }, 450);
    }, durationMs);
  });
}

// ----- Leader spotlight — sweeper over skjermen og lander på et element -----
export function spotlightPlayer(playerId){
  const target = document.querySelector(`[data-pid="${playerId}"]`);
  if (!target) return;
  const r = target.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const el = document.createElement('div');
  el.className = 'spotlight-sweep';
  el.style.setProperty('--target-x', cx + 'px');
  el.style.setProperty('--target-y', cy + 'px');
  document.body.appendChild(el);
  // target card får subtil løft
  target.classList.add('spotlit');
  setTimeout(() => {
    el.classList.add('locked');
  }, 900);
  setTimeout(() => {
    el.classList.add('fade');
  }, 1800);
  setTimeout(() => {
    el.remove();
    target.classList.remove('spotlit');
  }, 2400);
}

// ----- Time-pressure-modus (siste 5 sek) -----
let _timePressureActive = false;
let _tpTimer = null;
let _tpHeartbeat = null;
export function timePressureStart(onHeartbeat){
  if (_timePressureActive) return;
  _timePressureActive = true;
  document.body.classList.add('time-pressure');
  // Hjerteslagstakt akselererer
  let interval = 900;
  const beat = () => {
    if (!_timePressureActive) return;
    onHeartbeat && onHeartbeat();
    _tpHeartbeat = setTimeout(beat, interval);
    interval = Math.max(320, interval - 90);
  };
  _tpTimer = setTimeout(beat, 50);
}
export function timePressureStop(){
  _timePressureActive = false;
  document.body.classList.remove('time-pressure');
  clearTimeout(_tpTimer); clearTimeout(_tpHeartbeat);
  _tpTimer = _tpHeartbeat = null;
}

// ----- Rank change toast (for bruker på host-skjerm) -----
let _lastRank = new Map();
export function detectRankChanges(players){
  const sorted = players.slice().sort((a,b) => b.score - a.score);
  const changes = [];
  sorted.forEach((p, i) => {
    const prev = _lastRank.get(p.id);
    const newRank = i + 1;
    if (prev != null && newRank < prev && prev - newRank >= 1 && newRank <= 3){
      changes.push({ pid: p.id, name: p.name, emoji: p.emoji, from: prev, to: newRank });
    }
    _lastRank.set(p.id, newRank);
  });
  return changes;
}
export function resetRankTracking(){ _lastRank = new Map(); }

// ----- Score-tick animation på spiller-kort -----
export function tickUpScore(playerId, fromScore, toScore, durationMs = 700){
  const card = document.querySelector(`[data-pid="${playerId}"]`);
  if (!card) return;
  const el = card.querySelector('.score');
  if (!el) return;
  card.dataset.animating = '1';
  const start = performance.now();
  const delta = toScore - fromScore;
  const step = (now) => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(fromScore + delta * eased);
    if (t < 1) requestAnimationFrame(step);
    else {
      el.textContent = String(toScore);
      delete card.dataset.animating;
    }
  };
  requestAnimationFrame(step);
}

// ----- Live ticker (sports-broadcast-stil bunn-ticker) -----
let _tickerEl = null;
export function tickerShow(items){
  if (!_tickerEl){
    _tickerEl = document.createElement('div');
    _tickerEl.className = 'live-ticker';
    document.body.appendChild(_tickerEl);
  }
  const html = items.map(i => `<span class="tk-item"><span class="tk-em">${i.emoji || '•'}</span><span class="tk-name">${escapeHtml(i.name)}</span><span class="tk-score">${i.score}</span></span>`).join('<span class="tk-dot">•</span>');
  _tickerEl.innerHTML = `<div class="tk-track">${html}${html}</div>`;
  _tickerEl.classList.add('visible');
}
export function tickerHide(){
  if (_tickerEl) _tickerEl.classList.remove('visible');
}

// ----- Cinematic end-sequence -----
// Orchestrerer: dim → drumroll → podium-rise → awards-one-by-one → fanfare
export async function cinematicEnd(opts){
  const { podium = [], awards = [], onDrumroll, onFanfare, onSpotlight, onAwardTick } = opts;
  document.body.classList.add('dim-lights');
  await sleep(400);
  onDrumroll && onDrumroll();
  // Signaliser til host.js å bygge sluttskjerm skjult, deretter fade-in
  const stage = document.querySelector('.end-screen');
  if (stage){
    stage.classList.add('cinematic');
    // Sekvens: 3. plass → 2. → 1.
    const spots = stage.querySelectorAll('.podium-spot');
    spots.forEach(s => s.classList.add('hide'));
    await sleep(900);
    // Rekkefølge: bronze, silver, gold (DOM-rekkefølge kan variere)
    const ordered = [...spots].sort((a,b) => {
      const rank = (el) => el.querySelector('.podium-bar.gold') ? 0 : el.querySelector('.podium-bar.silver') ? 1 : 2;
      return rank(b) - rank(a);
    });
    for (let i = 0; i < ordered.length; i++){
      ordered[i].classList.remove('hide');
      ordered[i].classList.add('pop');
      onSpotlight && onSpotlight(i);
      await sleep(700);
    }
    await sleep(400);
    // Awards en-og-en
    const awardCards = stage.querySelectorAll('.award-card');
    awardCards.forEach(c => c.classList.add('hide'));
    for (let i = 0; i < awardCards.length; i++){
      awardCards[i].classList.remove('hide');
      awardCards[i].classList.add('pop');
      onAwardTick && onAwardTick(i);
      await sleep(550);
    }
    await sleep(500);
    onFanfare && onFanfare();
    stage.classList.add('finale');
  }
  await sleep(800);
  document.body.classList.remove('dim-lights');
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

// ----- Brand pulse — midlertidig løft på brand-tittel -----
export function brandPulse(kind = 'mint'){
  const brand = document.querySelector('.brand');
  if (!brand) return;
  brand.classList.remove('pulse-mint', 'pulse-gold', 'pulse-danger');
  void brand.offsetWidth;
  brand.classList.add('pulse-' + kind);
  setTimeout(() => brand.classList.remove('pulse-' + kind), 1600);
}

// ----- Full-screen lightning-flash (lyn-runde) -----
export function lightningFlash(){
  const el = document.createElement('div');
  el.className = 'lightning-flash';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// ----- Champion banner (bomb last survivor etc.) -----
export function championBanner(name, emoji){
  const el = document.createElement('div');
  el.className = 'champion-banner';
  el.innerHTML = `
    <div class="cb-top">CHAMPION</div>
    <div class="cb-name">${escapeHtml(emoji || '👑')} ${escapeHtml(name)}</div>
    <div class="cb-rays"></div>
  `;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('in'), 20);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3800);
}
