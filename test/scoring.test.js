import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeName,
  sanitizeEmoji,
  sanitizeText,
  clamp,
  quizPoints
} from '../lib/scoring.js';

test('sanitizeName strips < > (XSS) og kontrolltegn', () => {
  const out = sanitizeName('<script>Bob');
  assert.ok(!out.includes('<') && !out.includes('>'), 'ingen vinkelparenteser');
  assert.equal(out, 'scriptBob');
  assert.equal(sanitizeName('A\u0001\u007fB'), 'AB');
});

test('sanitizeName trimmer og klipper til 20 tegn', () => {
  assert.equal(sanitizeName('   Kari   '), 'Kari');
  assert.equal(sanitizeName('x'.repeat(50)).length, 20);
  assert.equal(sanitizeName(undefined), '');
  assert.equal(sanitizeName(null), '');
});

test('sanitizeEmoji slipper aldri gjennom < > (innerHTML på host)', () => {
  const out = sanitizeEmoji('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<') && !out.includes('>'));
});

test('sanitizeEmoji faller tilbake til 🦊 når tomt, beholder ekte emoji', () => {
  assert.equal(sanitizeEmoji(''), '🦊');
  assert.equal(sanitizeEmoji(undefined), '🦊');
  assert.equal(sanitizeEmoji('<>'), '🦊');
  assert.equal(sanitizeEmoji('😀'), '😀');
  assert.ok(sanitizeEmoji('abcdefghij').length <= 6);
});

test('sanitizeText fjerner kontrolltegn og respekterer maks-lengde', () => {
  assert.equal(sanitizeText('hello\u0000world'), 'helloworld');
  assert.equal(sanitizeText('a'.repeat(500), 300).length, 300);
  assert.equal(sanitizeText('  hei  '), 'hei');
  assert.equal(sanitizeText(undefined), '');
});

test('clamp begrenser og gulver til heltall', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
  assert.equal(clamp(5.9, 0, 10), 5);
});

test('quizPoints: fullt svar = 1000, ingen tid igjen = 500-gulv', () => {
  assert.equal(quizPoints({ deadline: 20000, answeredAt: 0, secs: 20, isLightning: false }), 1000);
  assert.equal(quizPoints({ deadline: 20000, answeredAt: 20000, secs: 20, isLightning: false }), 500);
  // svar etter deadline gir aldri negativt
  assert.equal(quizPoints({ deadline: 20000, answeredAt: 25000, secs: 20, isLightning: false }), 500);
});

test('quizPoints: halv tid igjen gir halv fartsbonus', () => {
  assert.equal(quizPoints({ deadline: 20000, answeredAt: 10000, secs: 20, isLightning: false }), 750);
});

test('quizPoints: fartsbonus er kappet på 500 (maks 1000 før mult)', () => {
  // answeredAt før normalt vindu kan ikke gi mer enn 1000
  assert.equal(quizPoints({ deadline: 20000, answeredAt: -5000, secs: 20, isLightning: false }), 1000);
});

test('quizPoints: lyn-runde dobler poengene', () => {
  assert.equal(quizPoints({ deadline: 5000, answeredAt: 0, secs: 5, isLightning: true }), 2000);
  assert.equal(quizPoints({ deadline: 5000, answeredAt: 5000, secs: 5, isLightning: true }), 1000);
});
