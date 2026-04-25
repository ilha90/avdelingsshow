// Bomb-chars — 30 varianter fordelt på 4 tiers.
// Hver variant definerer farger + evt. spesial-effekt (sheen, pattern, glow).

export const BOMB_CHARS = [
  // ===== CLASSIC (8) =====
  { id: 'classic',  name: 'Klassisk',   tier: 'classic', suit: '#7A2432', hair: '#FFD95A', tie: '#4030A0', accent: '#C02A3A' },
  { id: 'forest',   name: 'Skogvokter', tier: 'classic', suit: '#1B5E20', hair: '#8D6E63', tie: '#FFD54F', accent: '#4CAF50' },
  { id: 'royal',    name: 'Kongelig',   tier: 'classic', suit: '#1A237E', hair: '#D32F2F', tie: '#FFD700', accent: '#3F51B5' },
  { id: 'sunset',   name: 'Solnedgang', tier: 'classic', suit: '#BF360C', hair: '#FFCC80', tie: '#FFAB00', accent: '#FF6F00' },
  { id: 'galaxy',   name: 'Galakse',    tier: 'classic', suit: '#4A148C', hair: '#B39DDB', tie: '#00E5FF', accent: '#7C4DFF' },
  { id: 'coral',    name: 'Korall',     tier: 'classic', suit: '#D81B60', hair: '#6D4C41', tie: '#FFF59D', accent: '#EC407A' },
  { id: 'ocean',    name: 'Havet',      tier: 'classic', suit: '#006064', hair: '#212121', tie: '#FFFFFF', accent: '#00ACC1' },
  { id: 'shadow',   name: 'Skygge',     tier: 'classic', suit: '#263238', hair: '#ECEFF1', tie: '#F44336', accent: '#546E7A' },

  // ===== GEM TIER (10) — edelstener =====
  { id: 'ruby',     name: 'Rubin',      tier: 'gem', suit: '#9A0000', hair: '#FFE0E0', tie: '#FFD700', accent: '#E53935', sheen: 'ruby' },
  { id: 'emerald',  name: 'Smaragd',    tier: 'gem', suit: '#006B3C', hair: '#C8E6C9', tie: '#FFD700', accent: '#00C853', sheen: 'emerald' },
  { id: 'sapphire', name: 'Safir',      tier: 'gem', suit: '#0A2472', hair: '#BBDEFB', tie: '#E0F7FA', accent: '#0091EA', sheen: 'sapphire' },
  { id: 'amethyst', name: 'Ametyst',    tier: 'gem', suit: '#5E35B1', hair: '#D1C4E9', tie: '#F3E5F5', accent: '#9C27B0', sheen: 'amethyst' },
  { id: 'topaz',    name: 'Topas',      tier: 'gem', suit: '#E65100', hair: '#FFE0B2', tie: '#FFF59D', accent: '#FF8F00', sheen: 'topaz' },
  { id: 'opal',     name: 'Opal',       tier: 'gem', suit: '#B39DDB', hair: '#FFFFFF', tie: '#80DEEA', accent: '#F48FB1', sheen: 'opal' },
  { id: 'jade',     name: 'Jade',       tier: 'gem', suit: '#388E3C', hair: '#E8F5E9', tie: '#FFD700', accent: '#66BB6A', sheen: 'jade' },
  { id: 'onyx',     name: 'Onyks',      tier: 'gem', suit: '#000000', hair: '#BDBDBD', tie: '#9E9E9E', accent: '#424242', sheen: 'onyx' },
  { id: 'citrine',  name: 'Citrin',     tier: 'gem', suit: '#F9A825', hair: '#FFF9C4', tie: '#AB47BC', accent: '#FFB300', sheen: 'citrine' },
  { id: 'pearl',    name: 'Perle',      tier: 'gem', suit: '#F5F5F5', hair: '#E0E0E0', tie: '#B0BEC5', accent: '#EEEEEE', sheen: 'pearl' },

  // ===== METAL TIER (6) — metaller =====
  { id: 'bronze',   name: 'Bronse',     tier: 'metal', suit: '#8D6E63', hair: '#D7CCC8', tie: '#5D4037', accent: '#A1887F', sheen: 'bronze' },
  { id: 'silver',   name: 'Sølv',       tier: 'metal', suit: '#B0BEC5', hair: '#FFFFFF', tie: '#37474F', accent: '#CFD8DC', sheen: 'silver' },
  { id: 'gold',     name: 'Gull',       tier: 'metal', suit: '#D4A017', hair: '#FFFDE7', tie: '#B8860B', accent: '#FFC107', sheen: 'gold' },
  { id: 'platinum', name: 'Platina',    tier: 'metal', suit: '#E5E4E2', hair: '#FAFAFA', tie: '#757575', accent: '#9E9E9E', sheen: 'platinum' },
  { id: 'copper',   name: 'Kobber',     tier: 'metal', suit: '#B87333', hair: '#FFAB91', tie: '#5D4037', accent: '#D7875F', sheen: 'copper' },
  { id: 'titanium', name: 'Titan',      tier: 'metal', suit: '#4A4E50', hair: '#E0E0E0', tie: '#00ACC1', accent: '#607D8B', sheen: 'titanium' },

  // ===== LEGENDARY (6) — ekstraordinære =====
  { id: 'diamond',  name: 'Diamant',    tier: 'legendary', suit: '#E8F8FF', hair: '#B3E5FC', tie: '#40C4FF', accent: '#80D8FF', sheen: 'diamond' },
  { id: 'damascus', name: 'Damaskus',   tier: 'legendary', suit: '#37474F', hair: '#90A4AE', tie: '#CFD8DC', accent: '#78909C', sheen: 'damascus' },
  { id: 'obsidian', name: 'Obsidian',   tier: 'legendary', suit: '#0A0A0A', hair: '#B39DDB', tie: '#E91E63', accent: '#4527A0', sheen: 'obsidian' },
  { id: 'neon',     name: 'Neon',       tier: 'legendary', suit: '#1A1A1A', hair: '#00E5FF', tie: '#FF00E5', accent: '#00FF88', sheen: 'neon' },
  { id: 'hologram', name: 'Hologram',   tier: 'legendary', suit: '#E1BEE7', hair: '#B2EBF2', tie: '#FFF59D', accent: '#F8BBD0', sheen: 'hologram' },
  { id: 'cosmic',   name: 'Kosmisk',    tier: 'legendary', suit: '#1A0066', hair: '#FFFFFF', tie: '#FFD700', accent: '#FF00FF', sheen: 'cosmic' }
];

export function getChar(id){
  return BOMB_CHARS.find(c => c.id === id) || BOMB_CHARS[0];
}

// Tier-rangering for sortering + prising
export const TIER_ORDER = { classic: 0, gem: 1, metal: 2, legendary: 3 };

// Bygg SVG-streng for en karakter
// opts: { size, walking, facing: 'right'|'left', powerups: { fire, remote, speed, punch, shield, kick } }
export function buildCharSvg(c, opts = {}){
  const { size = 128, walking = false, facing = 'right', powerups = {} } = opts;
  const w = size;
  const h = Math.round(size * 340/220);

  // Spesial-sheens for tier-varianter
  const defs = `
    <defs>
      <linearGradient id="s_${c.id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${lighten(c.suit, 15)}"/>
        <stop offset="1" stop-color="${darken(c.suit, 15)}"/>
      </linearGradient>
      <linearGradient id="h_${c.id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${lighten(c.hair, 10)}"/>
        <stop offset="1" stop-color="${darken(c.hair, 15)}"/>
      </linearGradient>
      <linearGradient id="k_${c.id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFDEBE"/>
        <stop offset="1" stop-color="#EBBE92"/>
      </linearGradient>
      ${sheenDefs(c)}
    </defs>
  `;

  // Bein-animasjon (forskyving ved walking)
  const legOffsetA = walking ? 6 : 0;
  const legOffsetB = walking ? -6 : 0;

  // Flip horisontalt hvis facing='left'
  const flipTransform = facing === 'left' ? `<g transform="translate(220, 0) scale(-1, 1)">` : '<g>';

  const body = `
    ${flipTransform}
    <ellipse cx="110" cy="325" rx="70" ry="7" fill="rgba(0,0,0,.35)"/>
    <!-- Venstre arm -->
    <g>
      <path d="M72 180 Q55 175 48 195 L45 225 Q47 235 58 232 L62 210 L72 200 Z" fill="url(#s_${c.id})"/>
      <rect x="42" y="228" width="22" height="6" fill="${darken(c.suit, 30)}" rx="3"/>
      <circle cx="53" cy="238" r="11" fill="url(#k_${c.id})" stroke="#A07050" stroke-width="1"/>
    </g>
    <!-- Høyre arm -->
    <g>
      <path d="M148 180 Q165 175 175 195 L185 225 Q183 235 172 232 L168 210 L155 200 Z" fill="url(#s_${c.id})"/>
      <rect x="165" y="228" width="22" height="6" fill="${darken(c.suit, 30)}" rx="3"/>
      <circle cx="179" cy="238" r="11" fill="url(#k_${c.id})" stroke="#A07050" stroke-width="1"/>
      <path d="M188 234 Q198 232 200 238 L196 244 Q190 246 187 243 Z" fill="url(#k_${c.id})" stroke="#A07050" stroke-width="1"/>
    </g>
    <!-- Torso -->
    <path d="M62 180 Q52 290 90 300 L130 300 Q168 290 158 180 L140 175 L110 200 L80 175 Z" fill="url(#s_${c.id})"/>
    ${sheenOverlay(c)}
    <path d="M92 182 L80 175 L110 202 Z" fill="${darken(c.suit, 30)}"/>
    <path d="M128 182 L140 175 L110 202 Z" fill="${darken(c.suit, 30)}"/>
    <polygon points="105,202 115,202 118,255 102,255" fill="${c.tie}"/>
    <path d="M100 200 L110 208 L120 200 L118 210 L102 210 Z" fill="#fff"/>
    <circle cx="110" cy="230" r="2.8" fill="${c.accent}"/>
    <circle cx="110" cy="250" r="2.8" fill="${c.accent}"/>
    <circle cx="110" cy="270" r="2.8" fill="${c.accent}"/>
    <rect x="100" y="168" width="20" height="14" fill="url(#k_${c.id})"/>
    <!-- Ører -->
    <ellipse cx="58" cy="120" rx="8" ry="10" fill="url(#k_${c.id})" stroke="#A07050" stroke-width="1"/>
    <ellipse cx="162" cy="120" rx="8" ry="10" fill="url(#k_${c.id})" stroke="#A07050" stroke-width="1"/>
    <!-- Hode -->
    <ellipse cx="110" cy="115" rx="52" ry="55" fill="url(#k_${c.id})" stroke="#A07050" stroke-width="1"/>
    <!-- Hår -->
    <path d="M60 90 Q55 40 80 58 Q82 22 100 48 Q108 18 118 50 Q128 22 140 50 Q150 28 160 60 Q170 55 160 95 Q155 80 145 88 Q140 65 130 78 Q122 55 115 78 Q108 60 100 80 Q92 65 82 82 Q75 72 68 90 Z" fill="url(#h_${c.id})" stroke="${darken(c.hair, 25)}" stroke-width="1"/>
    <!-- Briller -->
    <rect x="72" y="106" width="30" height="22" rx="5" fill="rgba(180,220,255,.15)" stroke="#1a1a1a" stroke-width="2.5"/>
    <rect x="118" y="106" width="30" height="22" rx="5" fill="rgba(180,220,255,.15)" stroke="#1a1a1a" stroke-width="2.5"/>
    <line x1="102" y1="117" x2="118" y2="117" stroke="#1a1a1a" stroke-width="2.5"/>
    <!-- Øyne -->
    <circle cx="87" cy="117" r="3.2" fill="#2A60B0"/>
    <circle cx="133" cy="117" r="3.2" fill="#2A60B0"/>
    <!-- Smil -->
    <path d="M82 142 Q110 168 138 142 Q128 158 110 160 Q92 158 82 142 Z" fill="#8B2030"/>
    <rect x="90" y="144" width="40" height="9" fill="#fff" rx="1.5"/>
    <!-- Bein med walk-offset -->
    <rect x="94" y="298" width="10" height="10" fill="${darken(c.suit, 20)}" transform="translate(0, ${legOffsetA})"/>
    <rect x="116" y="298" width="10" height="10" fill="${darken(c.suit, 20)}" transform="translate(0, ${legOffsetB})"/>
    <!-- Sko -->
    <ellipse cx="95" cy="307" rx="16" ry="5" fill="${c.accent}" transform="translate(0, ${legOffsetA})"/>
    <ellipse cx="125" cy="307" rx="16" ry="5" fill="${c.accent}" transform="translate(0, ${legOffsetB})"/>
    ${powerupOverlays(powerups)}
    ${tierBadge(c)}
    </g>
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 340" width="${w}" height="${h}">${defs}${body}</svg>`;
}

// Sheen/pattern-defs per tier — brukes i <defs>
function sheenDefs(c){
  if (c.tier === 'classic') return '';
  const id = c.id;
  switch (c.sheen){
    case 'gold':
    case 'silver':
    case 'bronze':
    case 'copper':
    case 'platinum':
    case 'titanium':
      return `<linearGradient id="sh_${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${lighten(c.suit, 45)}" stop-opacity="0.6"/>
        <stop offset=".5" stop-color="${c.suit}" stop-opacity="0"/>
        <stop offset="1" stop-color="${lighten(c.suit, 60)}" stop-opacity="0.7"/>
      </linearGradient>`;
    case 'diamond':
      return `<linearGradient id="sh_${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.8"/>
        <stop offset=".3" stop-color="#80D8FF" stop-opacity="0.5"/>
        <stop offset=".7" stop-color="#E1F5FE" stop-opacity="0.9"/>
        <stop offset="1" stop-color="#B3E5FC" stop-opacity="0.6"/>
      </linearGradient>
      <pattern id="pat_${id}" x="0" y="0" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(15)">
        <line x1="0" y1="0" x2="18" y2="0" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
        <line x1="0" y1="0" x2="0" y2="18" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
      </pattern>`;
    case 'damascus':
      return `<pattern id="pat_${id}" x="0" y="0" width="22" height="8" patternUnits="userSpaceOnUse">
        <path d="M0 4 Q5.5 -1 11 4 T22 4" stroke="rgba(255,255,255,0.15)" stroke-width="1.2" fill="none"/>
        <path d="M0 4 Q5.5 9 11 4 T22 4" stroke="rgba(0,0,0,0.3)" stroke-width="0.8" fill="none"/>
      </pattern>`;
    case 'neon':
      return `<linearGradient id="sh_${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#00E5FF" stop-opacity="0.4"/>
        <stop offset=".5" stop-color="#FF00E5" stop-opacity="0.2"/>
        <stop offset="1" stop-color="#00FF88" stop-opacity="0.4"/>
      </linearGradient>
      <filter id="fl_${id}"><feGaussianBlur stdDeviation="0.6"/></filter>`;
    case 'cosmic':
      return `<radialGradient id="sh_${id}" cx=".5" cy=".5" r=".7">
        <stop offset="0" stop-color="#FFD700" stop-opacity="0.2"/>
        <stop offset=".4" stop-color="#FF00FF" stop-opacity="0.3"/>
        <stop offset="1" stop-color="#1A0066" stop-opacity="0.1"/>
      </radialGradient>`;
    case 'hologram':
      return `<linearGradient id="sh_${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FF80AB" stop-opacity="0.45"/>
        <stop offset=".33" stop-color="#80DEEA" stop-opacity="0.45"/>
        <stop offset=".66" stop-color="#FFF59D" stop-opacity="0.45"/>
        <stop offset="1" stop-color="#CE93D8" stop-opacity="0.45"/>
      </linearGradient>`;
    case 'obsidian':
      return `<linearGradient id="sh_${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#4527A0" stop-opacity="0.4"/>
        <stop offset=".5" stop-color="#000000" stop-opacity="0"/>
        <stop offset="1" stop-color="#E91E63" stop-opacity="0.3"/>
      </linearGradient>`;
    case 'ruby': case 'emerald': case 'sapphire': case 'amethyst':
    case 'topaz': case 'opal': case 'jade': case 'onyx': case 'citrine': case 'pearl':
      return `<radialGradient id="sh_${id}" cx=".35" cy=".35" r=".5">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.6"/>
        <stop offset="1" stop-color="${c.accent}" stop-opacity="0"/>
      </radialGradient>`;
  }
  return '';
}

// Overlay over torso for å gi tier-preg
function sheenOverlay(c){
  if (c.tier === 'classic') return `
    <g stroke="${lighten(c.suit, 10)}" stroke-width=".8" opacity=".55">
      <line x1="75" y1="195" x2="77" y2="290"/>
      <line x1="95" y1="200" x2="96" y2="290"/>
      <line x1="118" y1="200" x2="119" y2="290"/>
      <line x1="138" y1="195" x2="140" y2="290"/>
    </g>`;
  const id = c.id;
  if (c.sheen === 'diamond'){
    return `<path d="M62 180 Q52 290 90 300 L130 300 Q168 290 158 180 L140 175 L110 200 L80 175 Z" fill="url(#pat_${id})"/>
      <path d="M62 180 Q52 290 90 300 L130 300 Q168 290 158 180 L140 175 L110 200 L80 175 Z" fill="url(#sh_${id})"/>`;
  }
  if (c.sheen === 'damascus'){
    return `<path d="M62 180 Q52 290 90 300 L130 300 Q168 290 158 180 L140 175 L110 200 L80 175 Z" fill="url(#pat_${id})"/>`;
  }
  if (c.sheen === 'neon'){
    return `<path d="M62 180 Q52 290 90 300 L130 300 Q168 290 158 180 L140 175 L110 200 L80 175 Z" fill="url(#sh_${id})"/>
      <path d="M62 180 Q52 290 90 300 L130 300 Q168 290 158 180 L140 175 L110 200 L80 175 Z" fill="none" stroke="${c.accent}" stroke-width="2" filter="url(#fl_${id})"/>`;
  }
  // Øvrige (metal/gem/legendary): bare overlay sh_id
  return `<path d="M62 180 Q52 290 90 300 L130 300 Q168 290 158 180 L140 175 L110 200 L80 175 Z" fill="url(#sh_${id})"/>`;
}

// Liten badge-ikon øverst i venstre hjørne for premium tiers
function tierBadge(c){
  if (c.tier === 'classic') return '';
  const map = {
    gem: { icon: '💎', color: '#40C4FF' },
    metal: { icon: '🏅', color: '#FFC107' },
    legendary: { icon: '👑', color: '#FFD700' }
  };
  const t = map[c.tier];
  if (!t) return '';
  return `<g transform="translate(175 90)">
    <circle r="14" fill="${t.color}" opacity=".85" stroke="#fff" stroke-width="2"/>
    <text text-anchor="middle" y="5" font-size="16">${t.icon}</text>
  </g>`;
}

// Powerup-overlays på karakteren (vises når aktiv)
function powerupOverlays(pu){
  let s = '';
  if (pu.remote) s += `<text x="110" y="38" text-anchor="middle" font-size="22" filter="drop-shadow(0 0 4px rgba(176,116,255,.8))">📡</text>`;
  if (pu.fire) s += `<text x="85" y="80" text-anchor="middle" font-size="18" transform="rotate(-12 85 80)">🔥</text>`;
  if (pu.punch) s += `<text x="50" y="245" text-anchor="middle" font-size="14">🥊</text>`;
  if (pu.speed){
    // Vinger på sko — jo flere speed-nivåer, jo flere vinger
    const wings = Math.min(3, pu.speed || 1);
    for (let i = 0; i < wings; i++){
      s += `<text x="${85 + i*6}" y="${320 - i*6}" font-size="12" transform="rotate(-20 85 320)">💨</text>`;
    }
  }
  if (pu.shield) s += `<circle cx="110" cy="175" r="70" fill="none" stroke="#5de0ae" stroke-width="2" opacity=".55" stroke-dasharray="6,4"/>`;
  if (pu.kick) s += `<text x="130" y="315" text-anchor="middle" font-size="14">👟</text>`;
  return s;
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
