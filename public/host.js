// host.js — vert-siden (storskjerm)
import { getAiConfig, saveAiConfig, generateQuestions, generateVotingPrompts } from '/ai.js';
import { avatarFor, colorFor } from '/avatars.js';
import { speak, stopSpeaking, isOn as ttsOn, setOn as ttsSetOn, getPreset as ttsPreset, setPreset as ttsSetPreset, PRESETS as TTS_PRESETS, testVoice as ttsTest, listVoices as ttsVoices, getVoiceURI as ttsGetVoice, setVoice as ttsSetVoice, getCurrentVoice as ttsCur, hasSupport as ttsSupport } from '/tts.js';
const socket = io({ transports: ['websocket', 'polling'], upgrade: true, rememberUpgrade: true });

// ==== Passord på host ====
function hostHello() {
  const pw = sessionStorage.getItem('host-pw') || '';
  socket.emit('host:hello', pw);
}
socket.on('host:ok', () => { /* OK, continue */ });
socket.on('host:denied', ({ reason } = {}) => {
  if (reason === 'taken') {
    alert('En annen vert er allerede koblet til. Åpne siden på nytt etter at de har lukket fanen sin.');
    return;
  }
  promptHostPassword();
});

function promptHostPassword() {
  const overlay = document.createElement('div');
  overlay.id = 'hostPwOverlay';
  overlay.className = 'game-menu-overlay open';
  overlay.style.zIndex = '100000';
  overlay.innerHTML = `
    <div class="game-menu" style="max-width:440px; text-align:center" onclick="event.stopPropagation()">
      <h2 style="font-size:32px">🔒 Host-passord</h2>
      <p class="menu-sub">Kun verten kan kjøre showet</p>
      <input id="hostPwInp" type="password" placeholder="Passord" autocomplete="off"
        style="width:100%; padding:16px 20px; border-radius:12px; border:2px solid var(--card-b);
        background:var(--card); color:var(--ink); font-size:18px; font-family:inherit; text-align:center; margin-bottom:14px">
      <div id="hostPwErr" style="color:var(--red); font-size:14px; min-height:18px; margin-bottom:10px"></div>
      <button class="btn btn-primary btn-lg" id="hostPwBtn" style="width:100%">Logg inn</button>
    </div>`;
  document.body.appendChild(overlay);
  const inp = document.getElementById('hostPwInp');
  const btn = document.getElementById('hostPwBtn');
  const err = document.getElementById('hostPwErr');
  setTimeout(() => inp.focus(), 50);
  const go = () => {
    const v = inp.value.trim();
    if (!v) { err.textContent = 'Skriv inn passord'; return; }
    sessionStorage.setItem('host-pw', v);
    err.textContent = '';
    btn.textContent = 'Sjekker…';
    btn.disabled = true;
    // Lytt én gang på resultat
    const onOk = () => { socket.off('host:denied', onDenied); overlay.remove(); };
    const onDenied = ({ reason } = {}) => {
      socket.off('host:ok', onOk);
      if (reason === 'taken') { overlay.remove(); alert('En annen vert er allerede tilkoblet.'); return; }
      err.textContent = 'Feil passord';
      sessionStorage.removeItem('host-pw');
      btn.textContent = 'Logg inn'; btn.disabled = false; inp.value = ''; inp.focus();
    };
    socket.once('host:ok', onOk);
    socket.once('host:denied', onDenied);
    socket.emit('host:hello', v);
  };
  btn.addEventListener('click', go);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

hostHello();
const main = document.getElementById('main');
const controls = document.getElementById('controls');
const phaseTag = document.getElementById('phaseTag');
const floaters = document.getElementById('floaters');
const trophiesEl = document.getElementById('trophies');

let state = null;
let connectUrl = '';
let timerRAF = null;
let lastPhase = null;
let lastQIndex = -99;
let tickAccum = 0;
let wheelRevealTimeout = null;

const PHASE_LABELS = {
  lobby: 'Lobby', countdown: 'Klar…', question: 'Spørsmål', reveal: 'Fasit',
  leaderboard: 'Poengtavle', wheel: 'Lykkehjul',
  voting: 'Avstemning', 'vote-result': 'Avstemning – resultat',
  'scatter-play': 'Kategori-kamp', 'scatter-review': 'Gjennomgang',
  icebreaker: 'Bli-kjent', snake: 'Slange-kamp', 'snake-end': 'Slange – resultat',
  bomb: 'Bomberman', 'bomb-end': 'Bomberman – resultat', end: 'Ferdig',
};

socket.emit = socket.emit;  // (nå styres host:hello via hostHello() over)
fetch('/connect-url').then(r => r.json()).then(j => { connectUrl = j.url; if (state) render(); });

// Fullscreen button
document.getElementById('fullscreenBtn')?.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
  else document.exitFullscreen();
});
document.getElementById('helpBtn')?.addEventListener('click', () => openHelpModal());

// ===== "Bli med selv" sidepanel =====
const selfPanel = document.getElementById('selfPanel');
const selfPanelFrame = document.getElementById('selfPanelFrame');
const selfPlayBtn = document.getElementById('selfPlayBtn');
function toggleSelfPanel(forceOpen) {
  const willOpen = forceOpen != null ? forceOpen : !selfPanel.classList.contains('open');
  if (willOpen) {
    if (!selfPanelFrame.src) selfPanelFrame.src = '/';
    selfPanel.classList.add('open');
    document.body.classList.add('self-panel-open');
    selfPlayBtn.classList.add('active');
  } else {
    selfPanel.classList.remove('open');
    document.body.classList.remove('self-panel-open');
    selfPlayBtn.classList.remove('active');
  }
}
selfPlayBtn?.addEventListener('click', () => toggleSelfPanel());
document.getElementById('selfPanelClose')?.addEventListener('click', () => toggleSelfPanel(false));

// ===== TTS-meny i topp-bar =====
const ttsBtn = document.getElementById('ttsBtn');
const ttsMenu = document.getElementById('ttsMenu');
function refreshTtsBtn() { ttsBtn.textContent = ttsOn() ? '🎙️' : '🔈'; ttsBtn.style.opacity = ttsOn() ? '1' : '.55'; }
refreshTtsBtn();
function renderTtsMenu() {
  const cur = ttsPreset();
  const voices = ttsVoices();
  const curVoiceURI = ttsGetVoice();
  const curV = ttsCur();
  ttsMenu.innerHTML = `
    <div class="tts-head">
      <b>Les opp spørsmål</b>
      <label class="tts-switch"><input type="checkbox" ${ttsOn() ? 'checked' : ''} id="ttsOnCb">
        <span></span></label>
    </div>
    ${!ttsSupport() ? `<p class="ai-note" style="color:var(--red)">Nettleseren støtter ikke TTS.</p>` :
      voices.length === 0 ? `<p class="ai-note" style="color:var(--red)">Fant ingen stemmer. Prøv å oppdatere siden eller bytt nettleser.</p>` : `
      <label class="ai-note" style="display:flex; flex-direction:column; gap:4px; margin-bottom: 8px">
        Stemme ${curV ? `(nå: ${curV.name.slice(0, 28)} · ${curV.lang})` : ''}
        <select id="ttsVoiceSel" style="background:var(--bg-2); color:var(--ink); border:1px solid var(--card-b); border-radius:6px; padding:6px 8px; font-family:inherit; font-size:12px">
          <option value="">Auto (norsk hvis tilgjengelig)</option>
          ${voices.map(v => `<option value="${esc(v.uri)}" ${v.uri === curVoiceURI ? 'selected' : ''}>${esc(v.name)} (${v.lang})</option>`).join('')}
        </select>
      </label>`}
    <div class="tts-presets">
      ${Object.entries(TTS_PRESETS).map(([k, v]) => `
        <button class="tts-preset ${k === cur ? 'active' : ''}" data-key="${k}">
          <b>${v.label}</b><span>${v.desc}</span>
        </button>`).join('')}
    </div>
    <button class="btn btn-ghost btn-sm" id="ttsTestBtn" style="width:100%">🔊 Test stemmen</button>`;
  ttsMenu.querySelector('#ttsOnCb').addEventListener('change', e => {
    ttsSetOn(e.target.checked);
    if (!e.target.checked) stopSpeaking();
    refreshTtsBtn();
  });
  ttsMenu.querySelector('#ttsVoiceSel')?.addEventListener('change', e => {
    ttsSetVoice(e.target.value);
    renderTtsMenu();
  });
  ttsMenu.querySelectorAll('.tts-preset').forEach(b => b.addEventListener('click', () => {
    ttsSetPreset(b.dataset.key);
    renderTtsMenu();
  }));
  ttsMenu.querySelector('#ttsTestBtn').addEventListener('click', (e) => { e.stopPropagation(); ttsTest(); });
}
ttsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = ttsMenu.classList.toggle('open');
  if (open) renderTtsMenu();
});
document.addEventListener('click', (e) => {
  if (!ttsMenu.contains(e.target) && e.target !== ttsBtn) ttsMenu.classList.remove('open');
});

// ===== Live emoji reactions (flytende bobler) =====
socket.on('reaction', ({ emoji, from }) => spawnFloater(emoji, from));

function spawnFloater(emoji, from) {
  const el = document.createElement('div');
  el.className = 'floater';
  const x = 20 + Math.random() * (window.innerWidth - 80);
  el.style.left = x + 'px';
  el.style.bottom = '80px';
  el.innerHTML = `<div class="floater-emoji">${emoji}</div><div class="floater-name">${esc(from || '')}</div>`;
  // Random drift
  el.style.setProperty('--drift', ((Math.random() - 0.5) * 200).toFixed(0) + 'px');
  floaters.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ===== Trophy popups =====
socket.on('trophies', (list) => {
  list.forEach((t, i) => setTimeout(() => spawnTrophy(t), i * 400));
});

function spawnTrophy({ emoji, label, name }) {
  const el = document.createElement('div');
  el.className = 'trophy-popup';
  el.innerHTML = `<div class="trophy-emoji">${emoji}</div>
    <div class="trophy-content">
      <div class="trophy-label">${esc(label)}</div>
      ${name ? `<div class="trophy-name">${esc(name)}</div>` : ''}
    </div>`;
  trophiesEl.appendChild(el);
  window.sfx?.fanfare();
  setTimeout(() => el.classList.add('fade'), 2500);
  setTimeout(() => el.remove(), 3200);
}

socket.on('state', s => {
  const prev = state;
  state = s;
  triggerPhaseEffects(prev, s);
  lastPhase = s.phase;
  lastQIndex = s.qIndex;
  // Bevar AI-input fokus/verdi hvis bruker skriver
  const ae = document.activeElement;
  const preservedId = ae && ['aiTopic','aiKey','aiEndpoint','aiModel'].includes(ae.id) ? ae.id : null;
  const preservedValue = preservedId ? ae.value : null;
  const preservedSelStart = preservedId && 'selectionStart' in ae ? ae.selectionStart : null;
  const preservedSelEnd = preservedId && 'selectionEnd' in ae ? ae.selectionEnd : null;
  render();
  if (preservedId) {
    const el = document.getElementById(preservedId);
    if (el) {
      el.value = preservedValue;
      el.focus();
      if (preservedSelStart != null) try { el.setSelectionRange(preservedSelStart, preservedSelEnd); } catch {}
    }
  }
});

function triggerPhaseEffects(prev, s) {
  if (!prev) return;
  if (prev.phase !== s.phase) {
    if (s.phase === 'reveal') { window.sfx?.reveal(); stopSpeaking(); }
    if (s.phase === 'wheel') { window.sfx?.spin(); stopSpeaking(); }
    if (s.phase === 'end') { stopSpeaking(); window.sfx?.fanfare(); window.confetti?.burst(); setTimeout(() => window.confetti?.burst(), 600); setTimeout(() => window.confetti?.burst(), 1400); window.sfx?.applause(); }
    if (s.phase === 'vote-result') { window.sfx?.reveal(); stopSpeaking(); }
    if (s.phase === 'scatter-review') { window.sfx?.reveal(); stopSpeaking(); }
  }
  // TTS: les opp nye spørsmål / avstemninger / icebreaker-prompts
  if (s.phase === 'question' && prev.phase !== 'question' && s.question && s.question.text) {
    if (!s.question.isEmoji) speak(s.question.text);
  }
  if (s.phase === 'voting' && prev.phase !== 'voting') {
    if (s.votingPrompt) speak('Hvem er mest sannsynlig til å ' + s.votingPrompt);
  }
  if (s.phase === 'icebreaker' && (prev.phase !== 'icebreaker' || prev.icebreakerPrompt !== s.icebreakerPrompt)) {
    if (s.icebreakerTarget && s.icebreakerPrompt) speak(`${s.icebreakerTarget}, ${s.icebreakerPrompt}`);
  }
  // Player joined sound
  if (prev.players.length < s.players.length) window.sfx?.join();
}

function render() {
  if (!state) return;
  phaseTag.textContent = PHASE_LABELS[state.phase] || state.phase;
  if (timerRAF) { cancelAnimationFrame(timerRAF); timerRAF = null; }
  if (wheelRevealTimeout) { clearTimeout(wheelRevealTimeout); wheelRevealTimeout = null; }

  switch (state.phase) {
    case 'lobby': renderLobby(); break;
    case 'countdown': renderCountdown(); break;
    case 'question': renderQuestion(); break;
    case 'reveal': renderReveal(); break;
    case 'leaderboard': renderLeaderboard(); break;
    case 'wheel': renderWheel(); break;
    case 'voting': renderVoting(); break;
    case 'vote-result': renderVoteResult(); break;
    case 'scatter-play': renderScatterPlay(); break;
    case 'scatter-review': renderScatterReview(); break;
    case 'icebreaker': renderIcebreaker(); break;
    case 'snake': renderSnake(); break;
    case 'snake-end': renderSnakeEnd(); break;
    case 'bomb': renderBomb(); break;
    case 'bomb-end': renderBombEnd(); break;
    case 'end': renderEnd(); break;
  }
  renderControls();
}

// ============ COUNTDOWN ============
function renderCountdown() {
  const endsAt = state.countdownEndsAt || Date.now() + 3000;
  main.innerHTML = `
    <div class="countdown-screen">
      <div class="countdown-meta">Spørsmål ${state.qIndex + 1} / ${state.total}${state.lightning ? ' ⚡ LYN-RUNDE' : ''}</div>
      <div class="countdown-num" id="cdNum">3</div>
    </div>`;
  const el = document.getElementById('cdNum');
  function tick() {
    const msLeft = endsAt - Date.now();
    const n = Math.ceil(msLeft / 1000);
    if (n <= 0) { el.textContent = 'GO!'; el.className = 'countdown-num go'; return; }
    if (el.textContent !== String(n)) {
      el.textContent = n;
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
      window.sfx?.countdown();
    }
    if (state.phase === 'countdown') requestAnimationFrame(tick);
  }
  tick();
}

// ============ LOBBY ============
function renderLobby() {
  const p = state.players;
  const teams = state.teams || [];
  main.innerHTML = `
    <div class="lobby">
      <div class="lobby-left">
        <h2>Velkommen til showet</h2>
        <p class="lead">Skann koden eller åpne lenken på telefonen din.</p>
        <div class="join-box">
          <img src="/qr" alt="QR">
          <div class="join-info">
            <b>Bli med på</b>
            <div class="url">${connectUrl.replace('http://', '')}</div>
            <span>Skriv et navn og du er inne.</span>
          </div>
        </div>
        <div class="lobby-config">
          <div class="cfg-row">
            <label>
              <input type="checkbox" id="cfgTeam" ${state.teamMode ? 'checked' : ''}>
              Lag-modus
            </label>
            <select id="cfgNumTeams" ${!state.teamMode ? 'disabled' : ''}>
              ${[2,3,4,5,6].map(n => `<option value="${n}" ${teams.length === n ? 'selected' : ''}>${n} lag</option>`).join('')}
            </select>
            ${state.teamMode ? `<button class="btn btn-ghost btn-sm" onclick="reshuffle()">🔀 Miks lag</button>` : ''}
          </div>
          <div class="cfg-row">
            <label>Spørsmål: <select id="cfgQCount">
              ${[5,8,10,12,15].map(n => `<option value="${n}" ${n === state.questionCount ? 'selected' : ''}>${n}</option>`).join('')}
            </select></label>
            <label>Tid pr spørsmål: <select id="cfgTime">
              ${[10000,15000,20000,30000].map(n => `<option value="${n}" ${n === state.timeLimit ? 'selected' : ''}>${n/1000} sek</option>`).join('')}
            </select></label>
          </div>
        </div>
        ${renderAiBox()}
      </div>
      <div class="lobby-right">
        <h3>Spillere <span class="count">${p.length}</span></h3>
        ${p.length === 0
          ? '<div class="empty-hint">Venter på at noen skal bli med…</div>'
          : (state.teamMode
              ? teams.map(t => {
                  const members = p.filter(x => x.teamId === t.id);
                  return `<div class="team-block" style="--team-color:${t.color}">
                    <div class="team-header"><span class="team-emoji">${t.emoji}</span>
                      <b class="team-name-ed" data-tid="${t.id}" title="Klikk for å endre navn">${esc(t.name)}</b>
                      <span class="team-count">${members.length}</span></div>
                    <div class="team-players">${members.map(x => `<span class="team-chip" title="Klikk for å fjerne" data-pid="${x.id}" data-pname="${esc(x.name)}"><span class="avatar-sm">${x.emoji || avatarFor(x.name)}</span> ${esc(x.name)}</span>`).join('') || '<span class="empty-hint-sm">–</span>'}</div>
                  </div>`;
                }).join('')
              : `<div class="players-grid">${p.map(x => `<div class="player-chip" title="Klikk for å fjerne" data-pid="${x.id}" data-pname="${esc(x.name)}"><span class="avatar">${x.emoji || avatarFor(x.name)}</span> ${esc(x.name)}</div>`).join('')}</div>`)
        }
      </div>
    </div>`;
  // Wire config
  const team = document.getElementById('cfgTeam');
  const num = document.getElementById('cfgNumTeams');
  const qc = document.getElementById('cfgQCount');
  const tm = document.getElementById('cfgTime');
  team?.addEventListener('change', () => socket.emit('host:config', { teamMode: team.checked, numTeams: +num.value }));
  num?.addEventListener('change', () => socket.emit('host:config', { numTeams: +num.value }));
  qc?.addEventListener('change', () => socket.emit('host:config', { questionCount: +qc.value }));
  tm?.addEventListener('change', () => socket.emit('host:config', { timeLimit: +tm.value }));

  // Kick-spiller: klikk på player-chip
  document.querySelectorAll('.player-chip[data-pid], .team-chip[data-pid]').forEach(el => {
    el.addEventListener('click', () => {
      const pid = el.dataset.pid;
      const pname = el.dataset.pname;
      if (confirm(`Fjern ${pname} fra spillet?`)) socket.emit('host:kick', pid);
    });
  });
  // Rename team: klikk på team-name
  document.querySelectorAll('.team-name-ed').forEach(el => {
    el.addEventListener('click', () => {
      const id = +el.dataset.tid;
      const cur = el.textContent;
      const n = prompt('Nytt navn for laget:', cur);
      if (n && n.trim() && n.trim() !== cur) socket.emit('host:rename-team', { id, name: n.trim() });
    });
  });
}

window.reshuffle = () => socket.emit('host:reshuffle-teams');

// ============ AI GENERATOR ============
let aiState = {
  status: 'idle',      // idle | working | ready | error | voting-ready
  mode: 'quiz',        // quiz | voting
  message: '',
  questions: null,
  title: '',
  votingPrompts: null,
  showSettings: false,
};

function renderAiBox() {
  const cfg = getAiConfig();
  const hasKey = !!cfg.apiKey;
  return `
    <div class="ai-box">
      <div class="ai-head">
        <div class="ai-title">🪄 Egendefinert med AI</div>
        <button class="ai-gear" onclick="toggleAiSettings()" title="Innstillinger">⚙️</button>
      </div>
      ${aiState.showSettings ? `
        <div class="ai-settings">
          <label>API-URL<input type="text" id="aiEndpoint" value="${esc(cfg.endpoint)}" placeholder="https://api.openai.com/v1/chat/completions"></label>
          <label>Modell<input type="text" id="aiModel" value="${esc(cfg.model)}" placeholder="gpt-4o-mini"></label>
          <label>API-nøkkel<input type="password" id="aiKey" value="${esc(cfg.apiKey)}" placeholder="sk-..." autocomplete="off"></label>
          <button class="btn btn-ghost btn-sm" onclick="saveAi()">💾 Lagre</button>
          <p class="ai-note">Nøkkelen lagres kun i nettleseren din. Serveren ser den aldri.</p>
        </div>` : ''}
      ${!hasKey && !aiState.showSettings ? `
        <p class="ai-note">Legg inn API-nøkkel under ⚙️ for å generere.</p>` : ''}
      <div class="ai-row">
        <input type="text" id="aiTopic" placeholder="Tema – f.eks. Premier League, gutta på hytta, IT-avdelingen..." ${aiState.status === 'working' ? 'disabled' : ''}>
        <select id="aiCount" ${aiState.status === 'working' ? 'disabled' : ''}>
          ${[5,8,10,12,15].map(n => `<option value="${n}" ${n === 10 ? 'selected' : ''}>${n} stk</option>`).join('')}
        </select>
        <select id="aiMode" ${aiState.status === 'working' ? 'disabled' : ''}>
          <option value="quiz">📝 Quiz</option>
          <option value="emoji">🎭 Emoji</option>
          <option value="voting">🗳️ Hvem er mest sannsynlig</option>
        </select>
        <button class="btn btn-primary btn-sm" onclick="generateAi()" ${aiState.status === 'working' || !hasKey ? 'disabled' : ''}>
          ${aiState.status === 'working' ? '⏳' : '✨ Generer'}
        </button>
      </div>
      ${aiState.status === 'ready' && aiState.questions ? `
        <div class="ai-ready">
          ✅ <b>${aiState.questions.length} spørsmål klare</b> — "${esc(aiState.title)}"
          <button class="btn btn-primary btn-sm" onclick="startCustomQuiz()">▶ Start nå</button>
          <button class="btn btn-ghost btn-sm" onclick="previewCustom()">👁 Forhåndsvis</button>
          <button class="btn btn-ghost btn-sm" onclick="resetAi()">✕</button>
        </div>` : ''}
      ${aiState.status === 'voting-ready' && aiState.votingPrompts ? `
        <div class="ai-ready">
          ✅ <b>${aiState.votingPrompts.length} nye "mest sannsynlig"-spørsmål</b> lagt i poolen
          <button class="btn btn-primary btn-sm" onclick="act('host:start-voting')">🗳️ Start runde</button>
          <button class="btn btn-ghost btn-sm" onclick="previewVoting()">👁 Se liste</button>
          <button class="btn btn-ghost btn-sm" onclick="resetAi()">✕</button>
        </div>` : ''}
      ${aiState.status === 'error' ? `<div class="ai-error">⚠️ ${esc(aiState.message)}</div>` : ''}
    </div>`;
}

window.toggleAiSettings = () => { aiState.showSettings = !aiState.showSettings; render(); };
window.saveAi = () => {
  const endpoint = document.getElementById('aiEndpoint').value.trim();
  const model = document.getElementById('aiModel').value.trim();
  const apiKey = document.getElementById('aiKey').value.trim();
  saveAiConfig({ endpoint, model, apiKey });
  aiState.showSettings = false;
  render();
};
window.generateAi = async () => {
  const topic = document.getElementById('aiTopic').value.trim();
  const count = +document.getElementById('aiCount').value;
  const mode = document.getElementById('aiMode').value;
  if (!topic) { aiState.status = 'error'; aiState.message = 'Skriv et tema først'; render(); return; }
  aiState.status = 'working';
  aiState.message = '';
  aiState.mode = mode;
  render();
  try {
    if (mode === 'voting') {
      const prompts = await generateVotingPrompts({ topic, count });
      aiState.votingPrompts = prompts;
      aiState.status = 'voting-ready';
      socket.emit('host:add-voting-prompts', prompts);
      render();
    } else {
      const result = await generateQuestions({ topic, count, tone: mode });
      aiState.questions = result.questions;
      aiState.title = result.title;
      aiState.status = 'ready';
      render();
    }
  } catch (e) {
    aiState.status = 'error';
    aiState.message = e.message || 'Generering feilet';
    render();
  }
};
window.startCustomQuiz = () => {
  if (!aiState.questions?.length) return;
  socket.emit('host:start-custom-quiz', { questions: aiState.questions, title: aiState.title });
  aiState = { status: 'idle', mode: 'quiz', message: '', questions: null, title: '', votingPrompts: null, showSettings: false };
};
window.previewCustom = () => {
  if (!aiState.questions) return;
  const txt = aiState.questions.map((q, i) =>
    `${i + 1}. ${q.q}\n` + q.a.map((a, j) => `   ${'ABCD'[j]}${j === q.c ? ' ✓' : ' '} ${a}`).join('\n')
  ).join('\n\n');
  alert(txt);
};
window.previewVoting = () => {
  if (!aiState.votingPrompts) return;
  alert(aiState.votingPrompts.map((p, i) => (i+1)+'. '+p).join('\n\n'));
};
window.resetAi = () => { aiState = { status: 'idle', mode: 'quiz', message: '', questions: null, title: '', votingPrompts: null, showSettings: false }; render(); };

// ============ QUESTION ============
function renderQuestion() {
  const q = state.question;
  const isEmoji = q.isEmoji;
  const answered = state.players.filter(p => p.answered).length;
  main.innerHTML = `
    <div class="q-screen">
      <div class="q-meta">
        <div>Spørsmål ${state.qIndex + 1} / ${state.total}</div>
        <div>${answered} / ${state.players.length} svar inne ${state.paused ? '· ⏸ Pause' : ''}</div>
      </div>
      ${isEmoji ? `<div class="q-emoji">${q.text}</div>` : `<div class="q-text">${esc(q.text)}</div>`}
      <div class="timer"><div class="timer-bar" id="tbar"></div></div>
      <div class="options">
        ${q.options.map((o, i) => `<div class="option option-${i}"><div class="marker">${'ABCD'[i]}</div>${esc(o)}</div>`).join('')}
      </div>
    </div>`;
  animateTimer(q.startedAt, q.timeLimit);
}

function renderReveal() {
  const q = state.question;
  main.innerHTML = `
    <div class="q-screen">
      <div class="q-meta"><div>Spørsmål ${state.qIndex + 1} / ${state.total}</div><div>Fasit</div></div>
      ${q.isEmoji ? `<div class="q-emoji">${q.text}</div>` : `<div class="q-text">${esc(q.text)}</div>`}
      <div class="options">
        ${q.options.map((o, i) => `<div class="option option-${i} ${i === q.correct ? 'correct' : 'dimmed'}"><div class="marker">${'ABCD'[i]}</div>${esc(o)}</div>`).join('')}
      </div>
      <div class="answered-row">
        <div>✅ ${state.players.filter(p => p.lastCorrect).length} riktig</div>
        <div>❌ ${state.players.filter(p => p.lastCorrect === false).length} feil</div>
        <div>💤 ${state.players.filter(p => p.lastCorrect === null).length} uten svar</div>
      </div>
    </div>`;
  if (state.players.filter(p => p.lastCorrect).length > 0) {
    window.confetti?.spawn(40, window.innerWidth / 2, window.innerHeight * 0.4);
    window.sfx?.correct();
  } else {
    window.sfx?.wrong();
  }
}

// ============ LEADERBOARD ============
function renderLeaderboard() {
  if (state.teamMode) {
    const teams = [...state.teams].sort((a, b) => b.score - a.score);
    main.innerHTML = `
      <div class="leaderboard">
        <h2>Lag-tavle</h2>
        ${teams.map((t, i) => {
          const members = state.players.filter(p => p.teamId === t.id);
          const avg = members.length ? Math.round(t.score / members.length) : 0;
          return `<div class="lb-row team-row" style="animation-delay:${i*80}ms; border-color:${t.color}">
            <div class="lb-rank">${i+1}</div>
            <div><span class="team-emoji">${t.emoji}</span> ${esc(t.name)} <span class="team-members-s">· ${members.length} spillere</span></div>
            <div class="lb-delta">snitt ${avg}</div>
            <div>${t.score} p</div>
          </div>`;
        }).join('')}
      </div>`;
  } else {
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    main.innerHTML = `
      <div class="leaderboard">
        <h2>Poengtavle</h2>
        ${sorted.slice(0, 10).map((p, i) => `
          <div class="lb-row" style="animation-delay: ${i * 80}ms">
            <div class="lb-rank">${i + 1}</div>
            <div><span class="avatar">${avatarFor(p.name)}</span> ${esc(p.name)}</div>
            <div class="lb-delta ${p.lastDelta ? '' : 'neg'}">${p.lastDelta ? '+' + p.lastDelta : '±0'}</div>
            <div>${p.score} p</div>
          </div>`).join('')}
      </div>`;
  }
}

// ============ WHEEL ============
function renderWheel() {
  const names = state.players.map(p => p.name);
  const n = names.length;
  if (!n) { main.innerHTML = '<div class="empty-hint">Ingen spillere på hjulet.</div>'; return; }
  const slice = 360 / n;
  const colors = ['#e54b4b', '#3a86ff', '#ffbe0b', '#29c46a', '#d4af37', '#a855f7', '#14b8a6', '#f97316'];
  const chosenIdx = state.wheelResult ? names.indexOf(state.wheelResult) : -1;
  const targetAngle = chosenIdx >= 0 ? -(chosenIdx * slice + slice / 2) : 0;
  const wheelAngle = 360 * 5 + targetAngle;
  const radius = 250, cx = 260, cy = 260;
  const segments = names.map((name, i) => {
    const a1 = (i * slice - 90) * Math.PI / 180;
    const a2 = ((i + 1) * slice - 90) * Math.PI / 180;
    const x1 = cx + radius * Math.cos(a1), y1 = cy + radius * Math.sin(a1);
    const x2 = cx + radius * Math.cos(a2), y2 = cy + radius * Math.sin(a2);
    const large = slice > 180 ? 1 : 0;
    const d = `M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} Z`;
    const mid = ((i + 0.5) * slice - 90) * Math.PI / 180;
    const tx = cx + radius * 0.65 * Math.cos(mid), ty = cy + radius * 0.65 * Math.sin(mid);
    const rot = (i + 0.5) * slice;
    return `<path d="${d}" fill="${colors[i % colors.length]}" stroke="#0b0d1a" stroke-width="3"/>
      <text x="${tx}" y="${ty}" transform="rotate(${rot} ${tx} ${ty})" text-anchor="middle" fill="#fff" font-weight="700" font-size="${Math.max(12, Math.min(24, 420 / n))}">${esc(name.slice(0, 14))}</text>`;
  }).join('');
  main.innerHTML = `
    <div class="wheel-wrap">
      <h2>Lykkehjulet snurrer…</h2>
      <div class="wheel">
        <div class="needle"></div>
        <svg id="wheelSvg" width="520" height="520" viewBox="0 0 520 520" style="transform: rotate(0deg)">
          ${segments}
          <circle cx="${cx}" cy="${cy}" r="30" fill="#0b0d1a" stroke="#d4af37" stroke-width="4"/>
        </svg>
      </div>
      <div id="wheelReveal" style="min-height: 80px"></div>
    </div>`;
  requestAnimationFrame(() => {
    const svg = document.getElementById('wheelSvg');
    if (svg) svg.style.transform = `rotate(${wheelAngle}deg)`;
  });
  if (state.wheelResult) {
    wheelRevealTimeout = setTimeout(() => {
      const r = document.getElementById('wheelReveal');
      if (r) r.innerHTML = `<div class="wheel-result">🎉 ${esc(state.wheelResult)} 🎉</div>`;
      window.confetti?.burst();
      window.sfx?.fanfare();
    }, 4600);
  }
}

// ============ VOTING ============
function renderVoting() {
  const answered = state.players.filter(p => p.voted).length;
  main.innerHTML = `
    <div class="voting-screen">
      <div class="voting-label">Hvem er mest sannsynlig…</div>
      <div class="voting-prompt">${esc(state.votingPrompt)}</div>
      <div class="voting-progress">
        <div class="voting-bar" style="width:${(answered / Math.max(1, state.players.length)) * 100}%"></div>
      </div>
      <div class="voting-status">${answered} / ${state.players.length} har stemt</div>
      <div class="voting-grid">
        ${state.players.map(p => `<div class="vote-chip ${p.voted ? 'voted' : ''}">${esc(p.name)}${p.voted ? ' ✓' : ''}</div>`).join('')}
      </div>
    </div>`;
}

function renderVoteResult() {
  const results = state.votingResults || [];
  const top = results[0];
  main.innerHTML = `
    <div class="voting-screen">
      <div class="voting-label">Hvem er mest sannsynlig…</div>
      <div class="voting-prompt">${esc(state.votingPrompt)}</div>
      ${top ? `<div class="vote-winner">🏆 ${esc(top.name)} <span class="vote-count">(${top.count} ${top.count === 1 ? 'stemme' : 'stemmer'})</span></div>` : ''}
      <div class="vote-results">
        ${results.slice(0, 8).map((r, i) => {
          const pct = top ? (r.count / top.count) * 100 : 0;
          return `<div class="vote-row">
            <div class="vote-name">${esc(r.name)}</div>
            <div class="vote-bar-wrap"><div class="vote-bar" style="width:${pct}%; animation-delay:${i*100}ms"></div></div>
            <div class="vote-num">${r.count}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  if (top) { window.confetti?.burst(); window.sfx?.applause(); }
}

// ============ SCATTERGORIES ============
function renderScatterPlay() {
  const answered = state.players.filter(p => p.answered).length;
  main.innerHTML = `
    <div class="scatter-screen">
      <div class="scatter-letter">${state.scatterLetter}</div>
      <div class="scatter-subtitle">Skriv ord som starter med <b>${state.scatterLetter}</b> i hver kategori</div>
      <div class="scatter-cats">
        ${state.scatterCategories.map(c => `<div class="scatter-cat">${esc(c)}</div>`).join('')}
      </div>
      <div class="timer"><div class="timer-bar" id="tbar"></div></div>
      <div class="scatter-status">${answered} / ${state.players.length} ferdig</div>
    </div>`;
  animateTimer(state.scatterStartedAt || Date.now(), state.scatterTimeLimit || 60000);
}

function renderScatterReview() {
  const review = state.scatterReview || [];
  const cats = state.scatterCategories;
  main.innerHTML = `
    <div class="scatter-review">
      <h2>Kategori-kamp — Bokstav ${state.scatterLetter}</h2>
      <table class="scatter-table">
        <thead>
          <tr><th>Spiller</th>${cats.map(c => `<th>${esc(c)}</th>`).join('')}<th>+</th></tr>
        </thead>
        <tbody>
          ${review.map(r => `<tr>
            <td><b>${esc(r.name)}</b></td>
            ${(r.answers || []).map((a, i) => {
              const word = (a || '').trim();
              const startsRight = word && word[0].toLowerCase() === state.scatterLetter.toLowerCase();
              return `<td class="${word ? (startsRight ? 'ok' : 'bad') : 'empty'}">${esc(word) || '—'}</td>`;
            }).join('')}
            <td class="scatter-delta">+${r.delta}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ============ ICEBREAKER ============
function renderIcebreaker() {
  main.innerHTML = `
    <div class="icebreaker-screen">
      <div class="icebreaker-label">Bli-kjent-kort</div>
      <div class="icebreaker-target">${esc(state.icebreakerTarget)}</div>
      <div class="icebreaker-prompt">${esc(state.icebreakerPrompt)}</div>
      <div class="icebreaker-hint">Gi mikken til ${esc(state.icebreakerTarget)} 🎤</div>
    </div>`;
}

// ============ SNAKE ============
let snakeSnap = null;
let snakeTimerRAF = null;

socket.on('snake:tick', s => {
  snakeSnap = s;
  if (state?.phase === 'snake') drawSnake();
});

function renderSnake() {
  const showCountdown = snakeSnap && !snakeSnap.started;
  main.innerHTML = `
    <div class="snake-screen">
      <div class="snake-top">
        <div class="snake-time" id="snakeTime">⏱ ${Math.ceil((snakeSnap?.timeLeft || 60000) / 1000)}s</div>
        <div class="snake-title">🐍 Slange-kamp</div>
        <div class="snake-info">Spis, og unngå kollisjoner!</div>
      </div>
      <div class="snake-arena">
        <div class="snake-canvas-wrap">
          <canvas id="snakeCanvas" width="1200" height="750"></canvas>
          ${showCountdown ? `<div class="snake-overlay"><div id="snakeCd" class="snake-countdown">${Math.ceil((snakeSnap.countdownLeft || 3000) / 1000)}</div></div>` : ''}
        </div>
        <div class="snake-scores" id="snakeScores"></div>
      </div>
    </div>`;
  drawSnake();
  snakeAnimateTimer();
}

function drawSnake() {
  const canvas = document.getElementById('snakeCanvas');
  if (!canvas || !snakeSnap) return;
  const ctx = canvas.getContext('2d');
  const cell = canvas.width / snakeSnap.grid.w;

  // Bakgrunn
  ctx.fillStyle = '#0b0d1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Rutenett
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= snakeSnap.grid.w; x++) {
    ctx.beginPath(); ctx.moveTo(x * cell, 0); ctx.lineTo(x * cell, canvas.height); ctx.stroke();
  }
  for (let y = 0; y <= snakeSnap.grid.h; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * cell); ctx.lineTo(canvas.width, y * cell); ctx.stroke();
  }

  // Tegn mat (gylden pulse)
  const pulse = 0.85 + 0.15 * Math.sin(Date.now() / 200);
  for (const f of snakeSnap.food) {
    const cx = f.x * cell + cell/2;
    const cy = f.y * cell + cell/2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.7);
    grad.addColorStop(0, '#f5d77a');
    grad.addColorStop(1, 'rgba(245,215,122,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, cell * 0.8 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d4af37';
    ctx.beginPath(); ctx.arc(cx, cy, cell * 0.3 * pulse, 0, Math.PI * 2); ctx.fill();
  }

  // Tegn snakes
  for (const s of snakeSnap.snakes) {
    if (!s.body.length) continue;
    const alpha = s.alive ? 1 : 0.25;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = s.color;
    // Body segments (med avrundet look)
    for (let i = 1; i < s.body.length; i++) {
      const seg = s.body[i];
      const r = cell * 0.4;
      ctx.beginPath();
      ctx.roundRect(seg.x * cell + cell*0.1, seg.y * cell + cell*0.1, cell * 0.8, cell * 0.8, r);
      ctx.fill();
    }
    // Head (større, med glow)
    const head = s.body[0];
    ctx.shadowColor = s.color;
    ctx.shadowBlur = s.alive ? 14 : 0;
    ctx.beginPath();
    ctx.roundRect(head.x * cell + cell*0.05, head.y * cell + cell*0.05, cell * 0.9, cell * 0.9, cell * 0.3);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Emoji på hodet
    if (s.emoji) {
      ctx.globalAlpha = alpha;
      ctx.font = `${cell * 0.75}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s.emoji, head.x * cell + cell/2, head.y * cell + cell/2 + 1);
    }
    ctx.globalAlpha = 1;
  }
  // Oppdater score-panel
  updateSnakeScores();
}

function updateSnakeScores() {
  const el = document.getElementById('snakeScores');
  if (!el || !snakeSnap) return;
  const sorted = [...snakeSnap.snakes].sort((a, b) => b.score - a.score);
  el.innerHTML = sorted.map((s, i) => `
    <div class="snake-score-row ${s.alive ? '' : 'dead'}" style="border-color:${s.color}">
      <div class="snake-score-rank">${i + 1}</div>
      <div class="snake-score-name">${s.emoji || '🐍'} ${esc(s.name)}</div>
      <div class="snake-score-val" style="color:${s.color}">${s.score}</div>
      ${!s.alive && s.respawnIn > 0 ? `<div class="snake-score-resp">↺ ${Math.ceil(s.respawnIn/1000)}s</div>` : ''}
    </div>`).join('');
}

function snakeAnimateTimer() {
  if (snakeTimerRAF) cancelAnimationFrame(snakeTimerRAF);
  const el = document.getElementById('snakeTime');
  const cdEl = document.getElementById('snakeCd');
  function tick() {
    if (!snakeSnap || state?.phase !== 'snake') return;
    if (el) el.textContent = `⏱ ${Math.max(0, Math.ceil(snakeSnap.timeLeft / 1000))}s`;
    if (cdEl && !snakeSnap.started) cdEl.textContent = Math.max(1, Math.ceil(snakeSnap.countdownLeft / 1000));
    snakeTimerRAF = requestAnimationFrame(tick);
  }
  tick();
}

function renderSnakeEnd() {
  const snakes = snakeSnap ? [...snakeSnap.snakes].sort((a, b) => b.score - a.score) : [];
  const top3 = snakes.slice(0, 3);
  main.innerHTML = `
    <div class="end-screen">
      <h2>🐍 Slange-resultat 🐍</h2>
      <div class="podium">
        ${top3[1] ? `<div class="podium-col p2" style="border-color:${top3[1].color}"><div class="podium-medal">🥈</div><div class="podium-avatar">${top3[1].emoji || '🐍'}</div><div class="podium-name">${esc(top3[1].name)}</div><div class="podium-score">${top3[1].score} p</div></div>` : ''}
        ${top3[0] ? `<div class="podium-col p1" style="border-color:${top3[0].color}"><div class="podium-medal">🥇</div><div class="podium-avatar">${top3[0].emoji || '🐍'}</div><div class="podium-name">${esc(top3[0].name)}</div><div class="podium-score">${top3[0].score} p</div></div>` : ''}
        ${top3[2] ? `<div class="podium-col p3" style="border-color:${top3[2].color}"><div class="podium-medal">🥉</div><div class="podium-avatar">${top3[2].emoji || '🐍'}</div><div class="podium-name">${esc(top3[2].name)}</div><div class="podium-score">${top3[2].score} p</div></div>` : ''}
      </div>
      <p style="color: var(--ink-2); font-size: 16px; margin-top: 20px">Poeng er lagt til hovedscoren</p>
    </div>`;
  for (let i = 0; i < 3; i++) setTimeout(() => window.confetti?.burst(), i * 500);
  window.sfx?.fanfare();
}

// ============ BOMBERMAN ============
let bombSnap = null;
let bombWallsCache = null;
let bombTimerRAF = null;

socket.on('bomb:tick', s => {
  if (s.walls) bombWallsCache = s.walls;
  else if (bombWallsCache) s.walls = bombWallsCache;
  bombSnap = s;
  if (state?.phase === 'bomb') drawBomb();
});

function renderBomb() {
  const showCountdown = bombSnap && !bombSnap.started;
  main.innerHTML = `
    <div class="snake-screen">
      <div class="snake-top">
        <div class="snake-time" id="bombTime">⏱ ${Math.ceil((bombSnap?.timeLeft || 90000) / 1000)}s</div>
        <div class="snake-title">💣 Bomberman</div>
        <div class="snake-info">Spreng veggene, knus motstanderen</div>
      </div>
      <div class="snake-arena">
        <div class="snake-canvas-wrap">
          <canvas id="bombCanvas" width="1250" height="750"></canvas>
          ${showCountdown ? `<div class="snake-overlay"><div id="bombCd" class="snake-countdown">${Math.ceil((bombSnap.countdownLeft || 3000) / 1000)}</div></div>` : ''}
        </div>
        <div class="snake-scores" id="bombScores"></div>
      </div>
    </div>`;
  drawBomb();
  bombAnimateTimer();
}

function drawBomb() {
  const canvas = document.getElementById('bombCanvas');
  if (!canvas || !bombSnap) return;
  const ctx = canvas.getContext('2d');
  const cell = Math.floor(canvas.width / bombSnap.grid.w);
  const totalW = cell * bombSnap.grid.w;
  const totalH = cell * bombSnap.grid.h;
  canvas.height = totalH;

  // Bakgrunn (gress)
  ctx.fillStyle = '#1a2e1f';
  ctx.fillRect(0, 0, totalW, totalH);
  // Subtile grass-prikker
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let i = 0; i < 200; i++) {
    ctx.fillRect(Math.random() * totalW, Math.random() * totalH, 2, 2);
  }

  // Vegger
  const W = bombSnap.grid.w;
  for (let y = 0; y < bombSnap.grid.h; y++) {
    for (let x = 0; x < W; x++) {
      const v = bombSnap.walls[y * W + x];
      if (v === 1) {
        // Hard mur (mørk stein)
        const grad = ctx.createLinearGradient(x*cell, y*cell, x*cell, (y+1)*cell);
        grad.addColorStop(0, '#4a4a55');
        grad.addColorStop(1, '#2a2a35');
        ctx.fillStyle = grad;
        ctx.fillRect(x*cell, y*cell, cell, cell);
        ctx.strokeStyle = 'rgba(0,0,0,.3)';
        ctx.strokeRect(x*cell+0.5, y*cell+0.5, cell-1, cell-1);
      } else if (v === 2) {
        // Myk mur (tre)
        const grad = ctx.createLinearGradient(x*cell, y*cell, x*cell, (y+1)*cell);
        grad.addColorStop(0, '#a06a3f');
        grad.addColorStop(1, '#6f4721');
        ctx.fillStyle = grad;
        ctx.fillRect(x*cell+2, y*cell+2, cell-4, cell-4);
        ctx.strokeStyle = 'rgba(0,0,0,.4)';
        ctx.beginPath();
        ctx.moveTo(x*cell + cell/2, y*cell + 2);
        ctx.lineTo(x*cell + cell/2, y*cell + cell - 2);
        ctx.stroke();
      }
    }
  }

  // Powerups
  for (const u of bombSnap.powerups) {
    const cx = u.x * cell + cell/2, cy = u.y * cell + cell/2;
    const pulse = 0.85 + 0.15 * Math.sin(Date.now() / 200);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.5);
    if (u.type === 'bomb') { grad.addColorStop(0, '#fff'); grad.addColorStop(1, 'rgba(255,80,80,0)'); }
    else { grad.addColorStop(0, '#fff'); grad.addColorStop(1, 'rgba(255,190,11,0)'); }
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, cell * 0.5 * pulse, 0, Math.PI * 2); ctx.fill();
    // Icon
    ctx.fillStyle = u.type === 'bomb' ? '#e54b4b' : '#ffbe0b';
    ctx.beginPath(); ctx.arc(cx, cy, cell * 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${cell * 0.3}px system-ui`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(u.type === 'bomb' ? '+' : '▶', cx, cy + 1);
  }

  // Bomber
  for (const b of bombSnap.bombs) {
    const cx = b.x * cell + cell/2, cy = b.y * cell + cell/2;
    const f = Math.max(0, b.tLeft / 2500);
    const pulse = 1 + 0.2 * Math.sin(Date.now() / (100 + f * 300));
    // Glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell);
    glow.addColorStop(0, 'rgba(229,75,75,.4)');
    glow.addColorStop(1, 'rgba(229,75,75,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, cell, 0, Math.PI * 2); ctx.fill();
    // Body
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(cx, cy, cell * 0.38 * pulse, 0, Math.PI * 2); ctx.fill();
    // Fuse
    ctx.fillStyle = f > 0.5 ? '#ffbe0b' : '#e54b4b';
    ctx.fillRect(cx - 2, cy - cell * 0.5, 4, cell * 0.15);
  }

  // Eksplosjoner
  for (const e of bombSnap.explosions) {
    const cx = e.x * cell + cell/2, cy = e.y * cell + cell/2;
    const f = e.tLeft / 700;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.7);
    grad.addColorStop(0, `rgba(255,255,220,${f})`);
    grad.addColorStop(0.4, `rgba(255,180,0,${f * .8})`);
    grad.addColorStop(1, `rgba(255,60,0,0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(e.x * cell, e.y * cell, cell, cell);
    // Sparks
    ctx.fillStyle = `rgba(255,200,60,${f})`;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * cell * 0.4;
      ctx.fillRect(cx + Math.cos(a)*r, cy + Math.sin(a)*r, 2, 2);
    }
  }

  // Spillere
  for (const p of bombSnap.players) {
    if (!p.alive && !p.deadAt) continue;
    const cx = p.x * cell + cell/2, cy = p.y * cell + cell/2;
    ctx.globalAlpha = p.alive ? 1 : 0.3;
    // Glow
    ctx.shadowColor = p.color; ctx.shadowBlur = p.alive ? 16 : 0;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(cx, cy, cell * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // Emoji
    if (p.emoji) {
      ctx.font = `${cell * 0.6}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.emoji, cx, cy + 1);
    }
    // Respawn timer
    if (!p.alive && p.respawnIn > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${cell * 0.3}px system-ui`;
      ctx.fillText(Math.ceil(p.respawnIn / 1000), cx, cy + cell * 0.55);
    }
    ctx.globalAlpha = 1;
  }
  updateBombScores();
}

function updateBombScores() {
  const el = document.getElementById('bombScores');
  if (!el || !bombSnap) return;
  const sorted = [...bombSnap.players].sort((a, b) => b.score - a.score);
  el.innerHTML = sorted.map((s, i) => `
    <div class="snake-score-row ${s.alive ? '' : 'dead'}" style="border-color:${s.color}">
      <div class="snake-score-rank">${i + 1}</div>
      <div class="snake-score-name">${s.emoji || '💣'} ${esc(s.name)}</div>
      <div class="snake-score-val" style="color:${s.color}">${s.score}</div>
      ${!s.alive && s.respawnIn > 0 ? `<div class="snake-score-resp">↺ ${Math.ceil(s.respawnIn/1000)}s</div>` : ''}
      ${s.alive ? `<div class="snake-score-resp">💣×${s.bombsMax} · ▶${s.range}</div>` : ''}
    </div>`).join('');
}

function bombAnimateTimer() {
  if (bombTimerRAF) cancelAnimationFrame(bombTimerRAF);
  function tick() {
    if (!bombSnap || state?.phase !== 'bomb') return;
    const el = document.getElementById('bombTime');
    const cdEl = document.getElementById('bombCd');
    if (el) el.textContent = `⏱ ${Math.max(0, Math.ceil(bombSnap.timeLeft / 1000))}s`;
    if (cdEl && !bombSnap.started) cdEl.textContent = Math.max(1, Math.ceil(bombSnap.countdownLeft / 1000));
    drawBomb();  // Re-draw hver frame for smooth explosion/pulse
    bombTimerRAF = requestAnimationFrame(tick);
  }
  tick();
}

function renderBombEnd() {
  const players = bombSnap ? [...bombSnap.players].sort((a, b) => b.score - a.score) : [];
  const top3 = players.slice(0, 3);
  main.innerHTML = `
    <div class="end-screen">
      <h2>💣 Bomberman-resultat 💣</h2>
      <div class="podium">
        ${top3[1] ? `<div class="podium-col p2" style="border-color:${top3[1].color}"><div class="podium-medal">🥈</div><div class="podium-avatar">${top3[1].emoji || '💣'}</div><div class="podium-name">${esc(top3[1].name)}</div><div class="podium-score">${top3[1].score} p · ${top3[1].kills} kills</div></div>` : ''}
        ${top3[0] ? `<div class="podium-col p1" style="border-color:${top3[0].color}"><div class="podium-medal">🥇</div><div class="podium-avatar">${top3[0].emoji || '💣'}</div><div class="podium-name">${esc(top3[0].name)}</div><div class="podium-score">${top3[0].score} p · ${top3[0].kills} kills</div></div>` : ''}
        ${top3[2] ? `<div class="podium-col p3" style="border-color:${top3[2].color}"><div class="podium-medal">🥉</div><div class="podium-avatar">${top3[2].emoji || '💣'}</div><div class="podium-name">${esc(top3[2].name)}</div><div class="podium-score">${top3[2].score} p · ${top3[2].kills} kills</div></div>` : ''}
      </div>
      <p style="color: var(--ink-2); font-size: 16px; margin-top: 20px">Poeng lagt til hovedscoren</p>
    </div>`;
  for (let i = 0; i < 3; i++) setTimeout(() => window.confetti?.burst(), i * 500);
  window.sfx?.fanfare();
}

// ============ END ============
function renderEnd() {
  const source = state.teamMode
    ? state.teams.map(t => ({ name: `${t.emoji} ${t.name}`, score: t.score, color: t.color }))
    : state.players.map(p => ({ name: p.name, emoji: p.emoji, score: p.score }));
  const sorted = [...source].sort((a, b) => b.score - a.score);
  const top3 = sorted.slice(0, 3);
  // Best stats (players only)
  const players = state.players.filter(p => (p.totalCorrect || 0) + (p.totalWrong || 0) > 0);
  const bestStreak = players.reduce((m, p) => (p.bestStreak || 0) > (m?.bestStreak || 0) ? p : m, null);
  const fastest = players.filter(p => p.fastestMs != null).reduce((m, p) => !m || p.fastestMs < m.fastestMs ? p : m, null);
  const mostCorrect = players.reduce((m, p) => (p.totalCorrect || 0) > (m?.totalCorrect || 0) ? p : m, null);
  const mostFirst = players.reduce((m, p) => (p.firstCount || 0) > (m?.firstCount || 0) ? p : m, null);

  main.innerHTML = `
    <div class="end-screen">
      <h2>🏆 ${state.teamMode ? 'Vinnerlag' : 'Vinnere'} 🏆</h2>
      <div class="podium">
        ${top3[1] ? podium(2, top3[1]) : ''}
        ${top3[0] ? podium(1, top3[0]) : ''}
        ${top3[2] ? podium(3, top3[2]) : ''}
      </div>
      ${!state.teamMode && players.length ? `
      <div class="final-stats">
        <h3>Kveldens heder</h3>
        <div class="stats-grid">
          ${mostCorrect ? `<div class="stat-card"><div class="stat-emoji">🎯</div><div class="stat-lbl">Mest riktige svar</div><div class="stat-val">${esc(mostCorrect.name)}</div><div class="stat-sub">${mostCorrect.totalCorrect} riktige</div></div>` : ''}
          ${bestStreak && (bestStreak.bestStreak || 0) >= 2 ? `<div class="stat-card"><div class="stat-emoji">🔥</div><div class="stat-lbl">Beste streak</div><div class="stat-val">${esc(bestStreak.name)}</div><div class="stat-sub">${bestStreak.bestStreak} på rad</div></div>` : ''}
          ${fastest ? `<div class="stat-card"><div class="stat-emoji">⚡</div><div class="stat-lbl">Raskest svar</div><div class="stat-val">${esc(fastest.name)}</div><div class="stat-sub">${(fastest.fastestMs/1000).toFixed(2)} sek</div></div>` : ''}
          ${mostFirst && (mostFirst.firstCount || 0) >= 1 ? `<div class="stat-card"><div class="stat-emoji">🥇</div><div class="stat-lbl">Kjappest på avtrekkeren</div><div class="stat-val">${esc(mostFirst.name)}</div><div class="stat-sub">${mostFirst.firstCount} ${mostFirst.firstCount === 1 ? 'gang' : 'ganger'} først</div></div>` : ''}
        </div>
      </div>` : ''}
      <p style="color: var(--ink-2); font-size: 18px; margin-top: 20px">Takk for i kveld!</p>
    </div>`;
  for (let i = 0; i < 5; i++) setTimeout(() => window.confetti?.burst(), i * 700);
  // Drumroll + applause
  window.sfx?.drumroll?.();
  setTimeout(() => window.sfx?.applause(), 1200);
}
function podium(rank, p) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
  return `<div class="podium-col p${rank}" ${p.color ? `style="border-color:${p.color}"` : ''}>
    <div class="podium-medal">${medal}</div>
    ${p.emoji ? `<div class="podium-avatar">${p.emoji}</div>` : ''}
    <div class="podium-name">${esc(p.name)}</div>
    <div class="podium-score">${p.score} p</div>
  </div>`;
}

// ============ CONTROLS ============
function renderControls() {
  let html = '';
  if (state.phase === 'lobby') {
    html = `<button class="btn btn-primary btn-lg cta" onclick="openGameMenu()">🎮 Velg spill</button>`;
  } else if (state.phase === 'question') {
    html = `
      ${state.paused
        ? `<button class="btn btn-primary" onclick="act('host:resume')">▶ Fortsett</button>`
        : `<button class="btn btn-ghost" onclick="act('host:pause')">⏸ Pause</button>`}
      <button class="btn btn-ghost" onclick="act('host:reveal')">Avslør nå</button>
      <button class="btn btn-ghost" onclick="act('host:skip')">⏭ Hopp over</button>`;
  } else if (state.phase === 'reveal') {
    html = `<button class="btn btn-primary" onclick="act('host:leaderboard')">📊 Poengtavle</button>
            <button class="btn btn-ghost" onclick="act('host:next')">Neste →</button>`;
  } else if (state.phase === 'leaderboard') {
    html = `<button class="btn btn-primary" onclick="act('host:next')">Neste →</button>`;
  } else if (state.phase === 'voting') {
    html = `<button class="btn btn-ghost" onclick="act('host:end-voting')">Avslutt stemming</button>`;
  } else if (state.phase === 'vote-result') {
    html = `<button class="btn btn-primary" onclick="act('host:start-voting')">🗳️ Ny runde</button>
            <button class="btn btn-ghost" onclick="act('host:reset')">← Lobby</button>`;
  } else if (state.phase === 'scatter-play') {
    html = `<button class="btn btn-ghost" onclick="act('host:end-scatter')">Avslutt runde</button>`;
  } else if (state.phase === 'scatter-review') {
    html = `<button class="btn btn-primary" onclick="act('host:start-scatter')">📝 Ny runde</button>
            <button class="btn btn-primary" onclick="act('host:leaderboard')">📊 Poengtavle</button>
            <button class="btn btn-ghost" onclick="act('host:reset')">← Lobby</button>`;
  } else if (state.phase === 'icebreaker') {
    html = `<button class="btn btn-primary" onclick="act('host:icebreaker')">💬 Neste kort</button>
            <button class="btn btn-ghost" onclick="act('host:reset')">← Lobby</button>`;
  } else if (state.phase === 'wheel') {
    html = `<button class="btn btn-ghost" onclick="act('host:wheel')">🎡 Snurr igjen</button>
            <button class="btn btn-primary" onclick="act('host:reset')">← Lobby</button>`;
  } else if (state.phase === 'snake') {
    html = `<button class="btn btn-ghost" onclick="act('host:end-snake')">Avslutt runde</button>`;
  } else if (state.phase === 'snake-end') {
    html = `<button class="btn btn-primary" onclick="act('host:start-snake')">🐍 Ny runde</button>
            <button class="btn btn-ghost" onclick="act('host:reset')">← Lobby</button>`;
  } else if (state.phase === 'bomb') {
    html = `<button class="btn btn-ghost" onclick="act('host:end-bomb')">Avslutt runde</button>`;
  } else if (state.phase === 'bomb-end') {
    html = `<button class="btn btn-primary" onclick="act('host:start-bomb')">💣 Ny runde</button>
            <button class="btn btn-ghost" onclick="act('host:reset')">← Lobby</button>`;
  } else if (state.phase === 'end') {
    html = `<button class="btn btn-primary" onclick="act('host:reset')">← Ny runde</button>`;
  }
  if (state.phase !== 'lobby' && state.phase !== 'end') {
    html += `<button class="btn btn-danger btn-sm" onclick="if(confirm('Avslutt spillet?')) act('host:reset')">Avslutt</button>`;
  }
  controls.innerHTML = html;
}

// ============ GAME MENU (modal) ============
window.openGameMenu = () => {
  if (!state || state.players.length === 0) {
    showToast('Venter på spillere — be dem skanne QR-koden først 📱');
    return;
  }
  document.getElementById('gameMenu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'gameMenu';
  menu.className = 'game-menu-overlay';
  menu.innerHTML = `
    <div class="game-menu" onclick="event.stopPropagation()">
      <button class="menu-close" onclick="closeGameMenu()">✕</button>
      <h2>Velg spill</h2>
      <p class="menu-sub">${state.players.length} ${state.players.length === 1 ? 'spiller' : 'spillere'} klar${state.players.length > 1 ? 'e' : ''}${state.teamMode ? ' · ' + state.teams.length + ' lag' : ''}</p>

      <div class="menu-section">
        <div class="menu-section-title">🧠 Quiz</div>
        <div class="menu-grid">
          <button class="menu-card quiz" onclick="pickGame('host:start-quiz','generelt')"><div class="emoji">🌍</div><b>Generelt</b><span>Allmennkunnskap</span></button>
          <button class="menu-card quiz" onclick="pickGame('host:start-quiz','norge')"><div class="emoji">🇳🇴</div><b>Norge</b><span>Historie og geografi</span></button>
          <button class="menu-card quiz" onclick="pickGame('host:start-quiz','dnb')"><div class="emoji">🏦</div><b>DNB & Finans</b><span>Bank og økonomi</span></button>
          <button class="menu-card quiz" onclick="pickGame('host:start-quiz','popkultur')"><div class="emoji">🎬</div><b>Pop-kultur</b><span>Film, musikk, serier</span></button>
          <button class="menu-card quiz" onclick="pickGame('host:start-quiz','emoji')"><div class="emoji">🎭</div><b>Emoji-gåter</b><span>Gjett film fra emojier</span></button>
        </div>
      </div>

      <div class="menu-section">
        <div class="menu-section-title">⚡ Lyn-runde <span style="color:var(--ink-2); font-weight:400">— 5 sek, dobbel poeng</span></div>
        <div class="menu-grid">
          <button class="menu-card lightning" onclick="pickGame('host:start-lightning','generelt')"><div class="emoji">🌍⚡</div><b>Generelt</b><span>Rask & farlig</span></button>
          <button class="menu-card lightning" onclick="pickGame('host:start-lightning','norge')"><div class="emoji">🇳🇴⚡</div><b>Norge</b><span>Ingen tid å tenke</span></button>
          <button class="menu-card lightning" onclick="pickGame('host:start-lightning','popkultur')"><div class="emoji">🎬⚡</div><b>Pop-kultur</b><span>Er du kjapp nok?</span></button>
          <button class="menu-card lightning" onclick="pickGame('host:start-lightning','emoji')"><div class="emoji">🎭⚡</div><b>Emoji</b><span>Instinkt-gåter</span></button>
        </div>
      </div>

      <div class="menu-section">
        <div class="menu-section-title">🎉 Sosiale spill</div>
        <div class="menu-grid">
          <button class="menu-card social" onclick="pickGame('host:start-voting')"><div class="emoji">🗳️</div><b>Hvem er mest sannsynlig</b><span>Anonyme avstemninger</span></button>
          <button class="menu-card social" onclick="pickGame('host:start-scatter')"><div class="emoji">📝</div><b>Kategori-kamp</b><span>Én bokstav, fem kategorier</span></button>
          <button class="menu-card social" onclick="pickGame('host:icebreaker')"><div class="emoji">💬</div><b>Bli-kjent-kort</b><span>Trekk et kort, del et svar</span></button>
          <button class="menu-card social" onclick="pickGame('host:wheel')"><div class="emoji">🎡</div><b>Lykkehjulet</b><span>Trekk en tilfeldig person</span></button>
          <button class="menu-card social" onclick="pickGame('host:start-snake')"><div class="emoji">🐍</div><b>Slange-kamp</b><span>Alle mot alle, 60 sek</span></button>
          <button class="menu-card social" onclick="pickGame('host:start-bomb')"><div class="emoji">💣</div><b>Bomberman</b><span>Spreng motstanderen, 90 sek</span></button>
        </div>
      </div>
    </div>`;
  menu.addEventListener('click', () => closeGameMenu());
  document.body.appendChild(menu);
  requestAnimationFrame(() => menu.classList.add('open'));
};

window.closeGameMenu = () => {
  const m = document.getElementById('gameMenu');
  if (!m) return;
  m.classList.remove('open');
  setTimeout(() => m.remove(), 200);
};

window.pickGame = (ev, arg) => {
  closeGameMenu();
  socket.emit(ev, arg);
};

// ============ KEYBOARD SHORTCUTS ============
window.addEventListener('keydown', (e) => {
  // Ignore when typing in inputs
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === '?') { e.preventDefault(); openHelpModal(); return; }
  if (e.key === 'Escape') { closeGameMenu(); closeHelpModal(); return; }
  if (!state) return;
  if (state.phase === 'question') {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); socket.emit('host:reveal'); return; }
    if (e.key.toLowerCase() === 'r') { socket.emit('host:reveal'); return; }
    if (e.key.toLowerCase() === 'p') { socket.emit(state.paused ? 'host:resume' : 'host:pause'); return; }
    if (e.key.toLowerCase() === 's') { socket.emit('host:skip'); return; }
  }
  if (state.phase === 'reveal') {
    if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); socket.emit('host:next'); return; }
    if (e.key.toLowerCase() === 'l') { socket.emit('host:leaderboard'); return; }
  }
  if (state.phase === 'leaderboard') {
    if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); socket.emit('host:next'); return; }
  }
  if (state.phase === 'voting') {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); socket.emit('host:end-voting'); return; }
  }
  if (state.phase === 'icebreaker') {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); socket.emit('host:icebreaker'); return; }
  }
  if (state.phase === 'wheel') {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); socket.emit('host:wheel'); return; }
  }
  if (state.phase === 'lobby') {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); openGameMenu(); return; }
  }
});

function openHelpModal() {
  document.getElementById('helpModal')?.remove();
  const m = document.createElement('div');
  m.id = 'helpModal';
  m.className = 'game-menu-overlay';
  m.innerHTML = `<div class="game-menu" style="max-width:560px" onclick="event.stopPropagation()">
    <button class="menu-close" onclick="closeHelpModal()">✕</button>
    <h2>⌨️ Tastatursnarveier</h2>
    <p class="menu-sub">For vert på storskjerm</p>
    <div class="help-list">
      <div><kbd>Space</kbd> <span>Avslør / neste / snurr / start menu</span></div>
      <div><kbd>R</kbd> <span>Avslør svar (under quiz)</span></div>
      <div><kbd>P</kbd> <span>Pause / fortsett</span></div>
      <div><kbd>S</kbd> <span>Hopp over spørsmål</span></div>
      <div><kbd>L</kbd> <span>Vis poengtavle etter reveal</span></div>
      <div><kbd>?</kbd> <span>Vis denne hjelpen</span></div>
      <div><kbd>Esc</kbd> <span>Lukk meny/hjelp</span></div>
    </div>
  </div>`;
  m.addEventListener('click', closeHelpModal);
  document.body.appendChild(m);
  requestAnimationFrame(() => m.classList.add('open'));
}
function closeHelpModal() {
  const m = document.getElementById('helpModal');
  if (!m) return;
  m.classList.remove('open');
  setTimeout(() => m.remove(), 200);
}
window.openHelpModal = openHelpModal;
window.closeHelpModal = closeHelpModal;

window.act = (ev, arg) => socket.emit(ev, arg);
window.startIfReady = (ev, arg) => {
  if (!state || state.players.length === 0) {
    showToast('Venter på spillere — be dem skanne QR-koden først 📱');
    return;
  }
  socket.emit(ev, arg);
};

function showToast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2800);
}

function animateTimer(startedAt, limit) {
  const bar = document.getElementById('tbar');
  if (!bar) return;
  let lastTickSecond = -1;
  function tick() {
    const elapsed = Date.now() - startedAt;
    const pct = Math.max(0, 1 - elapsed / limit);
    bar.style.width = (pct * 100).toFixed(1) + '%';
    const secondsLeft = Math.ceil((limit - elapsed) / 1000);
    if (secondsLeft <= 3 && secondsLeft > 0) bar.classList.add('urgent');
    else bar.classList.remove('urgent');
    if (secondsLeft <= 5 && secondsLeft > 0 && secondsLeft !== lastTickSecond && !state.paused) {
      lastTickSecond = secondsLeft;
      window.sfx?.countdown();
    }
    if (pct > 0 && (state.phase === 'question' || state.phase === 'scatter-play')) {
      timerRAF = requestAnimationFrame(tick);
    }
  }
  tick();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
