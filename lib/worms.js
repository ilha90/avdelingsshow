// lib/worms.js — rene, testbare hjelpere for Romkrig-turlogikk.
// Holdes fri for socket/io-avhengigheter så de kan enhetstestes (node --test).

export const WORMS_LIVES = 4;

// Bygg 2-lags turorden fra en (allerede stokket) spillerliste [{id}, ...]:
// annenhver til rødt (0) / blått (1), deretter interleavet r0,b0,r1,b1,...
// → balanserte lag (odde antall: rødt får én ekstra) + spawn-spredning.
export function buildTurnOrder(players){
  const reds = [], blues = [];
  players.forEach((p, i) => { (i % 2 === 0 ? reds : blues).push(p); });
  const order = [];
  const maxLen = Math.max(reds.length, blues.length);
  for (let i = 0; i < maxLen; i++){
    if (reds[i])  order.push({ pid: reds[i].id, team: 0 });
    if (blues[i]) order.push({ pid: blues[i].id, team: 1 });
  }
  return order;
}

// Hvilke lag har minst én levende orm. worms: Map eller iterable av {team,alive}.
export function aliveTeams(worms){
  const at = [false, false];
  const it = (worms && worms.values) ? worms.values() : worms;
  for (const w of it) if (w && w.alive) at[w.team] = true;
  return at;
}

// undefined = fortsatt i gang, 0/1 = vinnerlag, null = uavgjort (begge ute).
export function winnerFromAlive(at){
  if (at[0] && at[1]) return undefined;
  if (at[0]) return 0;
  if (at[1]) return 1;
  return null;
}

// Neste levende orm i turorden etter fromIdx (syklisk).
// order: array av pid (string) ELLER {pid}. isAlive(pid)=>bool.
// Returnerer ny idx, eller -1 hvis ingen levende finnes.
export function nextAliveIdx(order, fromIdx, isAlive){
  const n = order.length;
  if (n === 0) return -1;
  const pidAt = (i) => { const o = order[i]; return (o && o.pid != null) ? o.pid : o; };
  let idx = fromIdx, guard = 0;
  do { idx = (idx + 1) % n; guard++; }
  while (guard <= n && !isAlive(pidAt(idx)));
  return isAlive(pidAt(idx)) ? idx : -1;
}
