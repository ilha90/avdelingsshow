// lib/scoring.js — rene, sideeffekt-frie funksjoner.
// Trukket ut av server.js slik at scoring- og sanitiseringslogikk kan
// enhetstestes isolert fra den levende spilltilstanden. Endrer du en formel
// her, oppdater testene i test/scoring.test.js.

// Spillernavn: fjern kontrolltegn + < > (XSS), trim, maks 20 tegn.
export function sanitizeName(s){
  return String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20);
}

// Emoji/avatar: fjern kontrolltegn + < > (injiseres rått i innerHTML på host),
// trim, maks 6 tegn. Faller tilbake til 🦊 hvis tomt etter rensing.
export function sanitizeEmoji(s){
  return String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 6) || '🦊';
}

// Fritekst (AI-spørsmål, scatter-svar osv.): fjern kontrolltegn, trim, klipp.
export function sanitizeText(s, max = 300){
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

// Heltallsklemme.
export function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v|0)); }

// Quiz-poeng for et riktig svar:
//   500 grunnpoeng + opptil 500 fartsbonus (lineært i gjenstående tid),
//   doblet i lyn-runde. Returnerer 0-grunnlag hvis det ikke er tid igjen.
export function quizPoints({ deadline, answeredAt, secs, isLightning }){
  const mult = isLightning ? 2 : 1;
  const timeLeft = Math.max(0, (deadline - answeredAt) / 1000);
  return Math.round((500 + Math.min(500, (timeLeft / secs) * 500)) * mult);
}
