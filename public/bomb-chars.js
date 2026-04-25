// Bomb-chars — felles karakterdefinisjoner for klient og server.
// Hver variant har farger + navn som brukes både i karaktervelgeren
// og i 3D-rendering av spilleren.

export const BOMB_CHARS = [
  { id: 'classic',  name: 'Klassisk',   suit: '#7A2432', hair: '#FFD95A', tie: '#4030A0', accent: '#C02A3A' },
  { id: 'forest',   name: 'Skogvokter', suit: '#1B5E20', hair: '#8D6E63', tie: '#FFD54F', accent: '#4CAF50' },
  { id: 'royal',    name: 'Kongelig',   suit: '#1A237E', hair: '#D32F2F', tie: '#FFD700', accent: '#3F51B5' },
  { id: 'sunset',   name: 'Solnedgang', suit: '#BF360C', hair: '#FFCC80', tie: '#FFAB00', accent: '#FF6F00' },
  { id: 'galaxy',   name: 'Galakse',    suit: '#4A148C', hair: '#B39DDB', tie: '#00E5FF', accent: '#7C4DFF' },
  { id: 'coral',    name: 'Korall',     suit: '#D81B60', hair: '#6D4C41', tie: '#FFF59D', accent: '#EC407A' },
  { id: 'ocean',    name: 'Havet',      suit: '#006064', hair: '#212121', tie: '#FFFFFF', accent: '#00ACC1' },
  { id: 'shadow',   name: 'Skygge',     suit: '#263238', hair: '#ECEFF1', tie: '#F44336', accent: '#546E7A' }
];

export function getChar(id){
  return BOMB_CHARS.find(c => c.id === id) || BOMB_CHARS[0];
}

// Returnerer en SVG-streng for en karakter — brukes til billboard-sprites i 3D
// og til forhåndsvisning i karakter-velgeren.
export function buildCharSvg(c, { size = 128 } = {}){
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 340" width="${size}" height="${Math.round(size * 340/220)}">
    <defs>
      <linearGradient id="s_${c.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lighten(c.suit, 15)}"/><stop offset="1" stop-color="${darken(c.suit, 15)}"/></linearGradient>
      <linearGradient id="h_${c.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lighten(c.hair, 10)}"/><stop offset="1" stop-color="${darken(c.hair, 15)}"/></linearGradient>
      <linearGradient id="k_${c.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFDEBE"/><stop offset="1" stop-color="#EBBE92"/></linearGradient>
    </defs>
    <ellipse cx="110" cy="325" rx="70" ry="7" fill="rgba(0,0,0,.35)"/>
    <g>
      <path d="M148 180 Q165 175 175 195 L185 225 Q183 235 172 232 L168 210 L155 200 Z" fill="url(#s_${c.id})"/>
      <rect x="165" y="228" width="22" height="6" fill="${darken(c.suit, 30)}" rx="3"/>
      <circle cx="179" cy="238" r="11" fill="url(#k_${c.id})" stroke="#A07050" stroke-width="1"/>
      <path d="M188 234 Q198 232 200 238 L196 244 Q190 246 187 243 Z" fill="url(#k_${c.id})" stroke="#A07050" stroke-width="1"/>
    </g>
    <g>
      <path d="M72 180 Q55 175 48 195 L45 225 Q47 235 58 232 L62 210 L72 200 Z" fill="url(#s_${c.id})"/>
      <rect x="42" y="228" width="22" height="6" fill="${darken(c.suit, 30)}" rx="3"/>
      <circle cx="53" cy="238" r="11" fill="url(#k_${c.id})" stroke="#A07050" stroke-width="1"/>
    </g>
    <path d="M62 180 Q52 290 90 300 L130 300 Q168 290 158 180 L140 175 L110 200 L80 175 Z" fill="url(#s_${c.id})"/>
    <path d="M92 182 L80 175 L110 202 Z" fill="${darken(c.suit, 30)}"/>
    <path d="M128 182 L140 175 L110 202 Z" fill="${darken(c.suit, 30)}"/>
    <polygon points="105,202 115,202 118,255 102,255" fill="${c.tie}"/>
    <path d="M100 200 L110 208 L120 200 L118 210 L102 210 Z" fill="#fff"/>
    <circle cx="110" cy="230" r="2.8" fill="${c.accent}"/>
    <circle cx="110" cy="250" r="2.8" fill="${c.accent}"/>
    <circle cx="110" cy="270" r="2.8" fill="${c.accent}"/>
    <rect x="100" y="168" width="20" height="14" fill="url(#k_${c.id})"/>
    <ellipse cx="58" cy="120" rx="8" ry="10" fill="url(#k_${c.id})" stroke="#A07050" stroke-width="1"/>
    <ellipse cx="162" cy="120" rx="8" ry="10" fill="url(#k_${c.id})" stroke="#A07050" stroke-width="1"/>
    <ellipse cx="110" cy="115" rx="52" ry="55" fill="url(#k_${c.id})" stroke="#A07050" stroke-width="1"/>
    <path d="M60 90 Q55 40 80 58 Q82 22 100 48 Q108 18 118 50 Q128 22 140 50 Q150 28 160 60 Q170 55 160 95 Q155 80 145 88 Q140 65 130 78 Q122 55 115 78 Q108 60 100 80 Q92 65 82 82 Q75 72 68 90 Z" fill="url(#h_${c.id})" stroke="${darken(c.hair, 25)}" stroke-width="1"/>
    <rect x="72" y="106" width="30" height="22" rx="5" fill="rgba(180,220,255,.15)" stroke="#1a1a1a" stroke-width="2.5"/>
    <rect x="118" y="106" width="30" height="22" rx="5" fill="rgba(180,220,255,.15)" stroke="#1a1a1a" stroke-width="2.5"/>
    <line x1="102" y1="117" x2="118" y2="117" stroke="#1a1a1a" stroke-width="2.5"/>
    <circle cx="87" cy="117" r="3.2" fill="#2A60B0"/>
    <circle cx="133" cy="117" r="3.2" fill="#2A60B0"/>
    <g>
      <path d="M82 142 Q110 168 138 142 Q128 158 110 160 Q92 158 82 142 Z" fill="#8B2030"/>
      <rect x="90" y="144" width="40" height="9" fill="#fff" rx="1.5"/>
    </g>
    <ellipse cx="95" cy="305" rx="16" ry="5" fill="${c.accent}"/>
    <ellipse cx="125" cy="305" rx="16" ry="5" fill="${c.accent}"/>
  </svg>`;
}

function hex2rgb(h){
  const s = h.replace('#', '');
  return {
    r: parseInt(s.slice(0,2), 16),
    g: parseInt(s.slice(2,4), 16),
    b: parseInt(s.slice(4,6), 16)
  };
}
function rgb2hex(r, g, b){
  return '#' + [r, g, b].map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
}
function lighten(hex, pct){
  const { r, g, b } = hex2rgb(hex);
  const f = 1 + pct / 100;
  return rgb2hex(Math.min(255, r * f), Math.min(255, g * f), Math.min(255, b * f));
}
function darken(hex, pct){
  const { r, g, b } = hex2rgb(hex);
  const f = 1 - pct / 100;
  return rgb2hex(r * f, g * f, b * f);
}
