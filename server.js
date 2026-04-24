// server.js — Avdelingsshow live multiplayer
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';
import { QUIZ_CATEGORIES, MOST_LIKELY, SCATTERGORIES, ICEBREAKERS, TEAM_NAMES } from './public/data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const http = createServer(app);
const io = new Server(http);

app.use(express.static(join(__dirname, 'public')));
app.get('/host', (_, res) => res.sendFile(join(__dirname, 'public', 'host.html')));
app.get('/', (_, res) => res.sendFile(join(__dirname, 'public', 'player.html')));
app.get('/qr', async (_, res) => {
  const ips = getLocalIPs();
  const url = ips[0] ? `http://${ips[0]}:${PORT}` : `http://localhost:${PORT}`;
  try {
    const buf = await QRCode.toBuffer(url, { width: 400, margin: 1 });
    res.type('png').send(buf);
  } catch { res.status(500).send('qr-feil'); }
});
app.get('/connect-url', (_, res) => {
  const ips = getLocalIPs();
  res.json({ url: ips[0] ? `http://${ips[0]}:${PORT}` : `http://localhost:${PORT}` });
});

const PORT = process.env.PORT || 3000;

// ---- Game state ----
const game = {
  phase: 'lobby',           // lobby | question | reveal | leaderboard | wheel | voting | vote-result | scatter-play | scatter-review | icebreaker | end
  mode: null,               // quiz | emoji | voting | scatter | icebreaker
  category: null,           // key in QUIZ_CATEGORIES
  teamMode: false,
  teams: [],                // [{id, name, color, emoji, score}]
  questions: [],
  qIndex: -1,
  questionStartedAt: 0,
  timeLimit: 20000,
  configTimeLimit: 20000,
  players: new Map(),       // socketId -> {name, teamId, score, streak, lastDelta, lastCorrect, answered, vote, scatterAnswers}
  answers: new Map(),       // socketId -> {choice, ms}
  answerOrder: [],          // track who answered first (for FIRST trophy)
  hostId: null,
  wheelResult: null,
  paused: false,
  pauseRemainingMs: 0,
  lightning: false,
  countdownEndsAt: 0,
  // Voting specific
  votingPrompt: null,
  // Scattergories specific
  scatterLetter: null,
  scatterCategories: [],
  scatterSubmissions: new Map(),  // socketId -> [word, word, word, word, word]
  // Icebreaker specific
  icebreakerPrompt: null,
  icebreakerTarget: null,
  // Config
  questionCount: 10,
};

function publicState() {
  const showQuestion = ['countdown', 'question', 'reveal'].includes(game.phase);
  const q = showQuestion && game.questions[game.qIndex];
  return {
    phase: game.phase,
    mode: game.mode,
    category: game.category,
    teamMode: game.teamMode,
    teams: game.teams,
    qIndex: game.qIndex,
    total: game.questions.length,
    paused: game.paused,
    questionCount: game.questionCount,
    timeLimit: game.timeLimit,
    configTimeLimit: game.configTimeLimit,
    lightning: game.lightning,
    countdownEndsAt: game.phase === 'countdown' ? game.countdownEndsAt : 0,
    question: q ? {
      text: game.phase === 'countdown' ? null : q.q,
      options: game.phase === 'countdown' ? null : q.a,
      timeLimit: game.timeLimit,
      startedAt: game.questionStartedAt,
      correct: game.phase === 'reveal' ? q.c : null,
      isEmoji: !!q.isEmoji,
    } : null,
    players: [...game.players.entries()].map(([id, p]) => ({
      id, name: p.name, emoji: p.emoji, teamId: p.teamId, score: p.score,
      answered: p.answered, lastDelta: p.lastDelta, lastCorrect: p.lastCorrect, streak: p.streak,
      bestStreak: p.bestStreak || 0, totalCorrect: p.totalCorrect || 0, totalWrong: p.totalWrong || 0,
      fastestMs: p.fastestMs, firstCount: p.firstCount || 0,
      voted: p.vote != null,
    })),
    wheelResult: game.wheelResult,
    votingPrompt: game.votingPrompt,
    votingResults: game.phase === 'vote-result' ? computeVoteResults() : null,
    scatterLetter: game.scatterLetter,
    scatterCategories: game.scatterCategories,
    scatterStartedAt: game.phase === 'scatter-play' ? game.questionStartedAt : 0,
    scatterTimeLimit: game.phase === 'scatter-play' ? SCATTER_TIME : 0,
    scatterReview: game.phase === 'scatter-review' ? buildScatterReview() : null,
    icebreakerPrompt: game.icebreakerPrompt,
    icebreakerTarget: game.icebreakerTarget,
  };
}

function broadcast() { io.emit('state', publicState()); }

// ---- Lifecycle helpers ----
function resetPlayersForRound() {
  for (const p of game.players.values()) {
    p.answered = false; p.lastDelta = 0; p.lastCorrect = null;
    p.vote = null; p.scatterAnswers = null;
  }
  game.answers.clear();
  game.answerOrder = [];
  game.scatterSubmissions.clear();
}

function startQuestion() {
  game.phase = 'countdown';
  game.countdownEndsAt = Date.now() + 3200;
  resetPlayersForRound();
  broadcast();
  const idx = game.qIndex;
  setTimeout(() => {
    if (game.qIndex !== idx) return;
    game.phase = 'question';
    game.questionStartedAt = Date.now();
    broadcast();
    setTimeout(() => {
      if (game.phase === 'question' && game.qIndex === idx && !game.paused) revealAnswer();
    }, game.timeLimit + 500);
  }, 3000);
}

function revealAnswer() {
  if (game.phase !== 'question') return;
  const q = game.questions[game.qIndex];
  const teamDeltas = new Map();
  const trophies = [];
  const firstCorrect = game.answerOrder.find(sid => {
    const a = game.answers.get(sid);
    return a && a.choice === q.c;
  });
  for (const [sid, p] of game.players) {
    const a = game.answers.get(sid);
    if (a && a.choice === q.c) {
      const timeFactor = Math.max(0, 1 - a.ms / game.timeLimit);
      const baseMult = game.lightning ? 2 : 1;
      const base = (500 + Math.floor(500 * timeFactor)) * baseMult;
      const streakBonus = p.streak >= 1 ? p.streak * 100 : 0;
      const delta = base + streakBonus;
      p.score += delta;
      p.streak += 1;
      p.bestStreak = Math.max(p.bestStreak || 0, p.streak);
      p.totalCorrect = (p.totalCorrect || 0) + 1;
      p.fastestMs = p.fastestMs == null ? a.ms : Math.min(p.fastestMs, a.ms);
      p.lastDelta = delta;
      p.lastCorrect = true;
      if (sid === firstCorrect) {
        p.firstCount = (p.firstCount || 0) + 1;
        trophies.push({ type: 'first', name: p.name, emoji: '⚡', label: 'FØRSTE UTE' });
      }
      if (p.streak === 3) trophies.push({ type: 'streak', name: p.name, emoji: '🔥', label: '3 PÅ RAD' });
      else if (p.streak === 5) trophies.push({ type: 'streak', name: p.name, emoji: '🌋', label: '5 PÅ RAD' });
      else if (p.streak >= 7) trophies.push({ type: 'streak', name: p.name, emoji: '🚀', label: p.streak + ' PÅ RAD' });
      if (game.teamMode && p.teamId != null) {
        teamDeltas.set(p.teamId, (teamDeltas.get(p.teamId) || 0) + delta);
      }
    } else {
      p.streak = 0;
      p.lastDelta = 0;
      p.lastCorrect = a ? false : null;
      if (a) p.totalWrong = (p.totalWrong || 0) + 1;
      else p.totalSkipped = (p.totalSkipped || 0) + 1;
    }
  }
  const players = [...game.players.values()];
  if (players.length >= 2 && players.every(p => p.lastCorrect === true)) {
    trophies.push({ type: 'perfect', name: '', emoji: '💯', label: 'ALLE RIKTIG!' });
  }
  if (game.teamMode) {
    for (const [tid, delta] of teamDeltas) {
      const team = game.teams.find(t => t.id === tid);
      if (team) team.score += delta;
    }
  }
  game.phase = 'reveal';
  if (trophies.length) io.emit('trophies', trophies);
  broadcast();
}

function nextQuestion() {
  if (game.qIndex + 1 >= game.questions.length) {
    game.phase = 'end';
    broadcast();
    return;
  }
  game.qIndex += 1;
  startQuestion();
}

function startQuizGame(categoryKey, lightning = false) {
  const cat = QUIZ_CATEGORIES[categoryKey];
  if (!cat) return;
  game.mode = 'quiz';
  game.category = categoryKey;
  game.lightning = !!lightning;
  if (lightning) {
    game.timeLimit = 5000;
    game.questions = shuffle([...cat.questions]).slice(0, Math.min(12, cat.questions.length));
  } else {
    game.timeLimit = game.configTimeLimit;
    game.questions = shuffle([...cat.questions]).slice(0, game.questionCount);
  }
  game.qIndex = -1;
  for (const p of game.players.values()) {
    p.score = 0; p.streak = 0; p.bestStreak = 0; p.totalCorrect = 0;
    p.totalWrong = 0; p.totalSkipped = 0; p.fastestMs = null; p.firstCount = 0;
  }
  for (const t of game.teams) t.score = 0;
  nextQuestion();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function resetToLobby() {
  game.phase = 'lobby';
  game.mode = null;
  game.category = null;
  game.qIndex = -1;
  game.questions = [];
  game.wheelResult = null;
  game.paused = false;
  game.lightning = false;
  game.timeLimit = game.configTimeLimit;
  game.votingPrompt = null;
  game.scatterLetter = null;
  game.scatterCategories = [];
  game.scatterSubmissions.clear();
  game.icebreakerPrompt = null;
  game.icebreakerTarget = null;
  // Reset voting-pool til defaults (fjerner AI-lagde prompts når man går tilbake til lobby)
  customVotingPrompts.length = 0;
  refreshVotingPool();
  for (const p of game.players.values()) {
    p.score = 0; p.streak = 0; p.answered = false;
    p.lastDelta = 0; p.lastCorrect = null; p.vote = null; p.scatterAnswers = null;
  }
  for (const t of game.teams) t.score = 0;
  broadcast();
}

// ---- Team helpers ----
function enableTeams(numTeams) {
  game.teamMode = true;
  const n = Math.max(2, Math.min(TEAM_NAMES.length, numTeams || 2));
  game.teams = TEAM_NAMES.slice(0, n).map((t, i) => ({ id: i, ...t, score: 0 }));
  redistributePlayersToTeams();
}

function disableTeams() {
  game.teamMode = false;
  game.teams = [];
  for (const p of game.players.values()) p.teamId = null;
}

function redistributePlayersToTeams() {
  if (!game.teamMode) return;
  const players = [...game.players.values()];
  shuffle(players);
  players.forEach((p, i) => {
    p.teamId = i % game.teams.length;
  });
}

// ---- Voting ("Hvem er mest sannsynlig til å...") ----
const customVotingPrompts = []; // AI-added prompts for this session
let votingPool = [...MOST_LIKELY];
function refreshVotingPool() {
  votingPool = shuffle([...MOST_LIKELY, ...customVotingPrompts]);
}

function startVoting(prompt) {
  game.phase = 'voting';
  game.mode = 'voting';
  if (prompt) game.votingPrompt = prompt;
  else {
    if (!votingPool.length) refreshVotingPool();
    game.votingPrompt = votingPool.shift();
  }
  for (const p of game.players.values()) p.vote = null;
  broadcast();
}

function computeVoteResults() {
  const tally = new Map(); // playerId -> count
  for (const p of game.players.values()) {
    if (p.vote) tally.set(p.vote, (tally.get(p.vote) || 0) + 1);
  }
  const result = [];
  for (const [pid, count] of tally) {
    const target = game.players.get(pid);
    if (target) result.push({ id: pid, name: target.name, count });
  }
  return result.sort((a, b) => b.count - a.count);
}

function endVoting() {
  game.phase = 'vote-result';
  broadcast();
}

// ---- Scattergories ----
const SCATTER_TIME = 60000;
function startScatter() {
  game.phase = 'scatter-play';
  game.mode = 'scatter';
  game.scatterLetter = SCATTERGORIES.letters[Math.floor(Math.random() * SCATTERGORIES.letters.length)];
  game.scatterCategories = SCATTERGORIES.categorySets[Math.floor(Math.random() * SCATTERGORIES.categorySets.length)];
  game.scatterSubmissions.clear();
  for (const p of game.players.values()) { p.scatterAnswers = null; p.answered = false; p.lastDelta = 0; }
  game.questionStartedAt = Date.now();
  broadcast();
  const started = game.questionStartedAt;
  setTimeout(() => {
    if (game.phase === 'scatter-play' && game.questionStartedAt === started) endScatter();
  }, SCATTER_TIME + 500);
}

function endScatter() {
  // Score: 100 pr ord som starter med letter (case insensitive) og er unikt blant innsendinger for samme kategori
  const letter = (game.scatterLetter || '').toLowerCase();
  const counts = game.scatterCategories.map(() => new Map()); // catIdx -> word -> count

  for (const [sid, arr] of game.scatterSubmissions) {
    if (!arr) continue;
    arr.forEach((w, i) => {
      const word = (w || '').trim().toLowerCase();
      if (!word || word[0] !== letter) return;
      counts[i].set(word, (counts[i].get(word) || 0) + 1);
    });
  }

  // Award points
  for (const [sid, arr] of game.scatterSubmissions) {
    const p = game.players.get(sid);
    if (!p || !arr) continue;
    let delta = 0;
    arr.forEach((w, i) => {
      const word = (w || '').trim().toLowerCase();
      if (!word || word[0] !== letter) return;
      const c = counts[i].get(word) || 0;
      if (c === 1) delta += 100; // unique → full
      else if (c > 1) delta += 50; // shared
    });
    p.score += delta;
    p.lastDelta = delta;
    if (game.teamMode && p.teamId != null) {
      const team = game.teams.find(t => t.id === p.teamId);
      if (team) team.score += delta;
    }
  }
  game.phase = 'scatter-review';
  broadcast();
}

function buildScatterReview() {
  const rows = [];
  for (const [sid, arr] of game.scatterSubmissions) {
    const p = game.players.get(sid);
    if (!p || !arr) continue;
    rows.push({ name: p.name, teamId: p.teamId, answers: arr, delta: p.lastDelta || 0 });
  }
  rows.sort((a, b) => b.delta - a.delta);
  return rows;
}

// ---- Icebreaker ----
function drawIcebreaker() {
  const players = [...game.players.values()];
  if (!players.length) return;
  game.phase = 'icebreaker';
  game.mode = 'icebreaker';
  game.icebreakerPrompt = ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)];
  game.icebreakerTarget = players[Math.floor(Math.random() * players.length)].name;
  broadcast();
}

// ---- Socket handlers ----
io.on('connection', (socket) => {
  // Send initial state to new socket (fikser hvit skjerm)
  socket.emit('state', publicState());

  socket.on('host:hello', () => {
    game.hostId = socket.id;
    socket.emit('host:ok');
    broadcast();
  });

  socket.on('player:join', (name, emoji) => {
    const clean = String(name || '').trim().slice(0, 20);
    if (!clean) return;
    const taken = [...game.players.values()].some(p => p.name.toLowerCase() === clean.toLowerCase());
    if (taken) { socket.emit('join:error', 'Navnet er allerede i bruk'); return; }
    let teamId = null;
    if (game.teamMode && game.teams.length) {
      const sizes = game.teams.map(t => ({ id: t.id, n: [...game.players.values()].filter(p => p.teamId === t.id).length }));
      sizes.sort((a, b) => a.n - b.n);
      teamId = sizes[0].id;
    }
    const cleanEmoji = typeof emoji === 'string' && emoji.length <= 6 ? emoji : null;
    game.players.set(socket.id, {
      name: clean, emoji: cleanEmoji, teamId, score: 0, streak: 0, bestStreak: 0,
      answered: false, lastDelta: 0, lastCorrect: null,
      vote: null, scatterAnswers: null,
      totalCorrect: 0, totalWrong: 0, totalSkipped: 0, fastestMs: null, firstCount: 0,
    });
    socket.emit('join:ok', { name: clean, teamId, emoji: cleanEmoji });
    broadcast();
  });

  socket.on('player:answer', (choice) => {
    if (game.phase !== 'question') return;
    const p = game.players.get(socket.id);
    if (!p || p.answered) return;
    const ms = Date.now() - game.questionStartedAt;
    if (ms > game.timeLimit) return;
    game.answers.set(socket.id, { choice, ms });
    game.answerOrder.push(socket.id);
    p.answered = true;
    broadcast();
    if ([...game.players.values()].every(p => p.answered)) {
      setTimeout(() => { if (game.phase === 'question') revealAnswer(); }, 300);
    }
  });

  socket.on('player:react', (emoji) => {
    const allowed = ['🔥','❤️','😂','👏','💪','😱','🎉','🙌','💯','🤯'];
    if (!allowed.includes(emoji)) return;
    const p = game.players.get(socket.id);
    if (!p) return;
    io.emit('reaction', { emoji, from: p.name });
  });

  socket.on('player:vote', (targetId) => {
    if (game.phase !== 'voting') return;
    const p = game.players.get(socket.id);
    if (!p) return;
    if (!game.players.has(targetId)) return;
    p.vote = targetId;
    broadcast();
    // Auto-end when everyone has voted
    if ([...game.players.values()].every(p => p.vote != null)) {
      setTimeout(() => { if (game.phase === 'voting') endVoting(); }, 500);
    }
  });

  socket.on('player:scatter', (arr) => {
    if (game.phase !== 'scatter-play') return;
    const p = game.players.get(socket.id);
    if (!p) return;
    if (!Array.isArray(arr)) return;
    const cleaned = arr.slice(0, game.scatterCategories.length).map(x => String(x || '').slice(0, 40));
    game.scatterSubmissions.set(socket.id, cleaned);
    p.scatterAnswers = cleaned;
    p.answered = true;
    broadcast();
  });

  // ---- Host controls ----
  const isHost = () => socket.id === game.hostId;

  socket.on('host:config', (cfg) => {
    if (!isHost()) return;
    if (typeof cfg.teamMode === 'boolean') {
      if (cfg.teamMode) enableTeams(cfg.numTeams || 2);
      else disableTeams();
    }
    if (typeof cfg.numTeams === 'number' && game.teamMode) {
      enableTeams(cfg.numTeams);
    }
    if (typeof cfg.timeLimit === 'number') { game.timeLimit = Math.max(5000, Math.min(60000, cfg.timeLimit)); game.configTimeLimit = game.timeLimit; }
    if (typeof cfg.questionCount === 'number') game.questionCount = Math.max(3, Math.min(20, cfg.questionCount));
    broadcast();
  });

  socket.on('host:reshuffle-teams', () => {
    if (!isHost() || !game.teamMode) return;
    redistributePlayersToTeams();
    broadcast();
  });

  socket.on('host:start-quiz', (categoryKey) => {
    if (!isHost()) return;
    if (!game.players.size) return;
    startQuizGame(categoryKey, false);
  });

  socket.on('host:start-lightning', (categoryKey) => {
    if (!isHost()) return;
    if (!game.players.size) return;
    startQuizGame(categoryKey, true);
  });

  socket.on('host:start-custom-quiz', (payload) => {
    if (!isHost()) return;
    if (!game.players.size) return;
    const qs = Array.isArray(payload?.questions) ? payload.questions : [];
    const valid = qs.filter(q =>
      q && typeof q.q === 'string' && Array.isArray(q.a) && q.a.length === 4 &&
      typeof q.c === 'number' && q.c >= 0 && q.c <= 3
    ).map(q => ({
      q: String(q.q).slice(0, 300),
      a: q.a.map(x => String(x).slice(0, 120)),
      c: q.c,
      isEmoji: !!q.isEmoji,
    }));
    if (!valid.length) return;
    game.mode = 'quiz';
    game.lightning = false;
    game.timeLimit = game.configTimeLimit;
    game.category = 'custom:' + (payload.title || 'Egen quiz').slice(0, 40);
    game.questions = valid.slice(0, 25);
    game.qIndex = -1;
    for (const p of game.players.values()) {
      p.score = 0; p.streak = 0; p.bestStreak = 0; p.totalCorrect = 0;
      p.totalWrong = 0; p.totalSkipped = 0; p.fastestMs = null; p.firstCount = 0;
    }
    for (const t of game.teams) t.score = 0;
    nextQuestion();
  });

  socket.on('host:start-voting', () => {
    if (!isHost() || !game.players.size) return;
    startVoting();
  });

  socket.on('host:add-voting-prompts', (prompts) => {
    if (!isHost()) return;
    if (!Array.isArray(prompts)) return;
    const clean = prompts.filter(p => typeof p === 'string' && p.trim().length > 5).map(p => String(p).slice(0, 200));
    customVotingPrompts.push(...clean);
    refreshVotingPool();
    socket.emit('voting-prompts-added', { count: clean.length, total: customVotingPrompts.length });
  });

  socket.on('host:next-voting', () => {
    if (!isHost()) return;
    startVoting();
  });

  socket.on('host:end-voting', () => {
    if (!isHost()) return;
    endVoting();
  });

  socket.on('host:start-scatter', () => {
    if (!isHost() || !game.players.size) return;
    startScatter();
  });

  socket.on('host:end-scatter', () => {
    if (!isHost()) return;
    if (game.phase === 'scatter-play') endScatter();
  });

  socket.on('host:icebreaker', () => {
    if (!isHost() || !game.players.size) return;
    drawIcebreaker();
  });

  socket.on('host:wheel', () => {
    if (!isHost() || !game.players.size) return;
    const names = [...game.players.values()].map(p => p.name);
    game.phase = 'wheel';
    game.wheelResult = names[Math.floor(Math.random() * names.length)];
    broadcast();
  });

  socket.on('host:reveal', () => { if (isHost()) revealAnswer(); });
  socket.on('host:leaderboard', () => { if (isHost()) { game.phase = 'leaderboard'; broadcast(); } });
  socket.on('host:next', () => { if (isHost()) nextQuestion(); });
  socket.on('host:skip', () => {
    if (!isHost() || game.phase !== 'question') return;
    // Null out results — no one gets points, streaks reset for those who didn't answer
    for (const p of game.players.values()) {
      p.lastCorrect = null;
      p.lastDelta = 0;
      p.streak = 0;
    }
    game.phase = 'reveal';
    broadcast();
  });
  socket.on('host:pause', () => {
    if (!isHost() || game.phase !== 'question') return;
    game.paused = true;
    game.pauseRemainingMs = Math.max(0, game.timeLimit - (Date.now() - game.questionStartedAt));
    broadcast();
  });
  socket.on('host:resume', () => {
    if (!isHost() || !game.paused) return;
    game.paused = false;
    game.questionStartedAt = Date.now() - (game.timeLimit - game.pauseRemainingMs);
    broadcast();
  });
  socket.on('host:reset', () => { if (isHost()) resetToLobby(); });
  socket.on('host:rename-team', ({ id, name }) => {
    if (!isHost() || !game.teamMode) return;
    const team = game.teams.find(t => t.id === id);
    if (!team) return;
    const clean = String(name || '').trim().slice(0, 20);
    if (clean) { team.name = clean; broadcast(); }
  });

  socket.on('host:kick', (playerId) => {
    if (!isHost()) return;
    game.players.delete(playerId);
    io.to(playerId).emit('kicked');
    broadcast();
  });

  socket.on('disconnect', () => {
    if (game.players.has(socket.id)) {
      game.players.delete(socket.id);
      broadcast();
    }
    if (socket.id === game.hostId) {
      game.hostId = null;
      // Auto-reset til lobby når vert lukker
      resetToLobby();
    }
  });
});

// ---- Boot ----
function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }
  }
  return ips;
}

http.listen(PORT, async () => {
  const ips = getLocalIPs();
  const url = ips[0] ? `http://${ips[0]}:${PORT}` : `http://localhost:${PORT}`;
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║         AVDELINGSSHOW — live server          ║');
  console.log('╚══════════════════════════════════════════════╝\n');
  console.log('  Vert-skjerm (åpne på PC/projektor):');
  console.log(`    ${url}/host\n`);
  console.log('  Spillere kobler seg på (telefon/laptop):');
  ips.forEach(ip => console.log(`    http://${ip}:${PORT}`));
  console.log('');
  try {
    const qr = await QRCode.toString(url, { type: 'terminal', small: true });
    console.log(qr);
  } catch {}
  console.log(`  → Trykk Ctrl+C for å stoppe.\n`);
});
