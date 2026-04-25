// public/ai.js — valgfri AI-generering av quiz-spørsmål via bruker-levert API-key
// Key lagres i localStorage (aldri sendt til server).

const LS_KEY = 'avdelingsshow:ai_key';
const LS_URL = 'avdelingsshow:ai_url';
const LS_MODEL = 'avdelingsshow:ai_model';

export function getKey(){ return localStorage.getItem(LS_KEY) || ''; }
export function setKey(v){ localStorage.setItem(LS_KEY, v || ''); }
export function getUrl(){ return localStorage.getItem(LS_URL) || 'https://api.openai.com/v1/chat/completions'; }
export function setUrl(v){ localStorage.setItem(LS_URL, v || ''); }
export function getModel(){ return localStorage.getItem(LS_MODEL) || 'gpt-4o-mini'; }
export function setModel(v){ localStorage.setItem(LS_MODEL, v || ''); }

const SYSTEM_PROMPT = `Du lager quiz-spørsmål på norsk. Returner KUN gyldig JSON, ingen markdown.
Format:
{"questions":[{"q":"...","a":["..","..","..",".."],"c":0}, ...]}
- 4 alternativer per spørsmål
- c er indeks (0-3) for korrekt svar
- Hold spørsmål korte (< 120 tegn)
- Hvert alternativ kort (< 40 tegn)
- Blandt variasjon i riktig-svar-posisjon`;

export async function generateQuestions({ topic, count = 5 }){
  const key = getKey();
  if (!key) throw new Error('Ingen API-key satt');
  const url = getUrl();
  const model = getModel();

  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Lag ${count} quiz-spørsmål om: ${topic}` }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.8
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key
    },
    body: JSON.stringify(body)
  });
  if (!res.ok){
    const text = await res.text().catch(()=>'');
    throw new Error('AI-feil: ' + res.status + ' ' + text.slice(0,200));
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '{}';
  let parsed;
  try { parsed = JSON.parse(content); }
  catch(e){ throw new Error('AI ga ikke gyldig JSON'); }
  const qs = parsed.questions || [];
  return qs
    .filter(x => x && typeof x.q === 'string' && Array.isArray(x.a) && x.a.length === 4 && Number.isInteger(x.c))
    .map(x => ({ q: String(x.q).slice(0,300), a: x.a.map(s => String(s).slice(0,120)), c: Math.max(0, Math.min(3, x.c|0)) }));
}

export async function generateMostLikely({ topic = 'jobb og kollegaer', count = 8 }){
  const key = getKey();
  if (!key) throw new Error('Ingen API-key satt');
  const url = getUrl();
  const model = getModel();

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Returner JSON {"prompts":["til å...", ...]} med norske "Hvem er mest sannsynlig"-prompts. Morsomme, ufarlige, passer til avdelings-show på jobb.' },
        { role: 'user', content: `Lag ${count} prompts om: ${topic}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.9
    })
  });
  if (!res.ok) throw new Error('AI-feil ' + res.status);
  const data = await res.json();
  const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
  return (parsed.prompts || []).map(s => String(s).slice(0,200));
}
