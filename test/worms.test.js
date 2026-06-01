import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTurnOrder, aliveTeams, winnerFromAlive, nextAliveIdx } from '../lib/worms.js';

test('buildTurnOrder splitter balansert og interleaver r0,b0,r1,b1', () => {
  const players = [{id:'a'},{id:'b'},{id:'c'},{id:'d'}];
  const order = buildTurnOrder(players);
  assert.equal(order.length, 4);
  // annenhver til lag: a→0, b→1, c→0, d→1; interleave r0,b0,r1,b1: a,b,c,d
  assert.deepEqual(order.map(o => o.team), [0,1,0,1]);
  assert.deepEqual(order.map(o => o.pid), ['a','b','c','d']);
});

test('buildTurnOrder med odde antall: rødt får én ekstra', () => {
  const players = [{id:'a'},{id:'b'},{id:'c'},{id:'d'},{id:'e'}];
  const order = buildTurnOrder(players);
  const reds = order.filter(o => o.team === 0).length;
  const blues = order.filter(o => o.team === 1).length;
  assert.equal(order.length, 5);
  assert.equal(reds, 3);
  assert.equal(blues, 2);
  // siste element skal være den ekstra røde
  assert.deepEqual(order[order.length-1], { pid:'e', team:0 });
});

test('aliveTeams leser både Map og array', () => {
  const arr = [{team:0,alive:true},{team:1,alive:false},{team:1,alive:true}];
  assert.deepEqual(aliveTeams(arr), [true, true]);
  const m = new Map([['x',{team:0,alive:false}],['y',{team:0,alive:true}]]);
  assert.deepEqual(aliveTeams(m), [true, false]);
});

test('winnerFromAlive: pågår/0/1/uavgjort', () => {
  assert.equal(winnerFromAlive([true, true]), undefined);  // fortsatt i gang
  assert.equal(winnerFromAlive([true, false]), 0);
  assert.equal(winnerFromAlive([false, true]), 1);
  assert.equal(winnerFromAlive([false, false]), null);     // uavgjort
});

test('nextAliveIdx hopper over døde ormer syklisk', () => {
  const order = ['a','b','c','d'];                 // r,b,r,b
  const dead = new Set(['b']);
  const isAlive = pid => !dead.has(pid);
  // fra a(0): neste levende = c(2) (b er død)
  assert.equal(nextAliveIdx(order, 0, isAlive), 2);
  // fra c(2): neste levende = d(3)
  assert.equal(nextAliveIdx(order, 2, isAlive), 3);
  // fra d(3): wrap til a(0)
  assert.equal(nextAliveIdx(order, 3, isAlive), 0);
});

test('nextAliveIdx på {pid}-objekter og start fra -1', () => {
  const order = [{pid:'a'},{pid:'b'},{pid:'c'}];
  const isAlive = () => true;
  assert.equal(nextAliveIdx(order, -1, isAlive), 0);  // første tur
});

test('nextAliveIdx returnerer -1 når ingen er levende', () => {
  const order = ['a','b'];
  assert.equal(nextAliveIdx(order, 0, () => false), -1);
});

test('nextAliveIdx finner eneste levende selv om den er current', () => {
  const order = ['a','b','c'];
  const isAlive = pid => pid === 'b';
  // fra b(1): wrap rundt, eneste levende er b selv
  assert.equal(nextAliveIdx(order, 1, isAlive), 1);
});
