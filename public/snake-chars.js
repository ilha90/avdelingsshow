// Snake-chars — 30 slange-varianter fordelt på 4 tiers.
// Hver variant har body, belly, eye og accent-farger + tier-sheen.

export const SNAKE_CHARS = [
  // ===== CLASSIC (8) =====
  { id: 'sn-green',   name: 'Grønn',      tier: 'classic', body: '#4CAF50', belly: '#A5D6A7', eye: '#263238', accent: '#2E7D32' },
  { id: 'sn-coral',   name: 'Korall',     tier: 'classic', body: '#FF7043', belly: '#FFCCBC', eye: '#1C1C1C', accent: '#D84315' },
  { id: 'sn-ocean',   name: 'Havet',      tier: 'classic', body: '#0288D1', belly: '#B3E5FC', eye: '#FFFF00', accent: '#01579B' },
  { id: 'sn-violet',  name: 'Fiolett',    tier: 'classic', body: '#7E57C2', belly: '#D1C4E9', eye: '#FFE082', accent: '#4527A0' },
  { id: 'sn-sunset',  name: 'Solnedgang', tier: 'classic', body: '#F57C00', belly: '#FFE0B2', eye: '#3E2723', accent: '#E65100' },
  { id: 'sn-rose',    name: 'Rosa',       tier: 'classic', body: '#EC407A', belly: '#F8BBD0', eye: '#37474F', accent: '#AD1457' },
  { id: 'sn-mint',    name: 'Mynte',      tier: 'classic', body: '#26A69A', belly: '#B2DFDB', eye: '#263238', accent: '#00695C' },
  { id: 'sn-shadow',  name: 'Skygge',     tier: 'classic', body: '#455A64', belly: '#B0BEC5', eye: '#FF5252', accent: '#263238' },

  // ===== GEM (10) =====
  { id: 'sn-ruby',     name: 'Rubin',    tier: 'gem', body: '#B71C1C', belly: '#EF9A9A', eye: '#FFF59D', accent: '#E53935', sheen: 'ruby' },
  { id: 'sn-emerald',  name: 'Smaragd',  tier: 'gem', body: '#00695C', belly: '#80CBC4', eye: '#FFD700', accent: '#00C853', sheen: 'emerald' },
  { id: 'sn-sapphire', name: 'Safir',    tier: 'gem', body: '#0D47A1', belly: '#90CAF9', eye: '#FFFFFF', accent: '#1976D2', sheen: 'sapphire' },
  { id: 'sn-amethyst', name: 'Ametyst',  tier: 'gem', body: '#4A148C', belly: '#CE93D8', eye: '#F8BBD0', accent: '#7B1FA2', sheen: 'amethyst' },
  { id: 'sn-topaz',    name: 'Topas',    tier: 'gem', body: '#BF360C', belly: '#FFCCBC', eye: '#FFF176', accent: '#E64A19', sheen: 'topaz' },
  { id: 'sn-opal',     name: 'Opal',     tier: 'gem', body: '#B39DDB', belly: '#F3E5F5', eye: '#80DEEA', accent: '#9575CD', sheen: 'opal' },
  { id: 'sn-jade',     name: 'Jade',     tier: 'gem', body: '#2E7D32', belly: '#C8E6C9', eye: '#FFD700', accent: '#388E3C', sheen: 'jade' },
  { id: 'sn-onyx',     name: 'Onyks',    tier: 'gem', body: '#212121', belly: '#616161', eye: '#E91E63', accent: '#424242', sheen: 'onyx' },
  { id: 'sn-citrine',  name: 'Citrin',   tier: 'gem', body: '#F57F17', belly: '#FFF59D', eye: '#7B1FA2', accent: '#FFB300', sheen: 'citrine' },
  { id: 'sn-pearl',    name: 'Perle',    tier: 'gem', body: '#EEEEEE', belly: '#FFFFFF', eye: '#546E7A', accent: '#BDBDBD', sheen: 'pearl' },

  // ===== METAL (6) =====
  { id: 'sn-bronze',   name: 'Bronse',   tier: 'metal', body: '#8D6E63', belly: '#D7CCC8', eye: '#FF5722', accent: '#5D4037', sheen: 'bronze' },
  { id: 'sn-silver',   name: 'Sølv',     tier: 'metal', body: '#B0BEC5', belly: '#ECEFF1', eye: '#1A237E', accent: '#607D8B', sheen: 'silver' },
  { id: 'sn-gold',     name: 'Gull',     tier: 'metal', body: '#C9A227', belly: '#FFF59D', eye: '#3E2723', accent: '#FFC107', sheen: 'gold' },
  { id: 'sn-platinum', name: 'Platina',  tier: 'metal', body: '#CFD8DC', belly: '#ECEFF1', eye: '#37474F', accent: '#9E9E9E', sheen: 'platinum' },
  { id: 'sn-copper',   name: 'Kobber',   tier: 'metal', body: '#A0522D', belly: '#FFAB91', eye: '#1A1A1A', accent: '#D7875F', sheen: 'copper' },
  { id: 'sn-titanium', name: 'Titan',    tier: 'metal', body: '#37474F', belly: '#607D8B', eye: '#00E5FF', accent: '#546E7A', sheen: 'titanium' },

  // ===== LEGENDARY (6) =====
  { id: 'sn-diamond',  name: 'Diamant',  tier: 'legendary', body: '#B3E5FC', belly: '#E1F5FE', eye: '#0277BD', accent: '#40C4FF', sheen: 'diamond' },
  { id: 'sn-damascus', name: 'Damaskus', tier: 'legendary', body: '#37474F', belly: '#78909C', eye: '#CFD8DC', accent: '#B0BEC5', sheen: 'damascus' },
  { id: 'sn-obsidian', name: 'Obsidian', tier: 'legendary', body: '#0A0A0A', belly: '#5E35B1', eye: '#FF1744', accent: '#4527A0', sheen: 'obsidian' },
  { id: 'sn-neon',     name: 'Neon',     tier: 'legendary', body: '#1A1A1A', belly: '#00E5FF', eye: '#FF00E5', accent: '#00FF88', sheen: 'neon' },
  { id: 'sn-hologram', name: 'Hologram', tier: 'legendary', body: '#E1BEE7', belly: '#B2EBF2', eye: '#FFF59D', accent: '#F8BBD0', sheen: 'hologram' },
  { id: 'sn-cosmic',   name: 'Kosmisk',  tier: 'legendary', body: '#1A0066', belly: '#B388FF', eye: '#FFD700', accent: '#FF00FF', sheen: 'cosmic' }
];

export function getSnakeChar(id){
  return SNAKE_CHARS.find(c => c.id === id) || SNAKE_CHARS[0];
}

// Forhåndsvisning — liten slange i sirkel-form
export function buildSnakePreviewSvg(c, { size = 120 } = {}){
  const id = c.id;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}">
    <defs>
      <linearGradient id="body_${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${lighten(c.body, 20)}"/>
        <stop offset="1" stop-color="${darken(c.body, 15)}"/>
      </linearGradient>
      ${sheenDefs(c)}
    </defs>
    <!-- Skygge -->
    <ellipse cx="100" cy="175" rx="75" ry="8" fill="rgba(0,0,0,.3)"/>
    <!-- S-formet slange-kropp -->
    <path d="M30 110 Q55 60, 100 90 Q145 120, 170 80" stroke="url(#body_${id})" stroke-width="32" stroke-linecap="round" fill="none"/>
    <!-- Belly highlight -->
    <path d="M30 110 Q55 60, 100 90 Q145 120, 170 80" stroke="${c.belly}" stroke-width="10" stroke-linecap="round" fill="none" opacity=".7"/>
    ${sheenStroke(c)}
    <!-- Hode -->
    <circle cx="170" cy="80" r="22" fill="url(#body_${id})" stroke="${darken(c.body, 25)}" stroke-width="1.5"/>
    <!-- Øyne (hvitt med pupiller) -->
    <circle cx="177" cy="73" r="5.5" fill="#fff"/>
    <circle cx="177" cy="73" r="3.2" fill="${c.eye}"/>
    <circle cx="178" cy="72" r="1.2" fill="#fff"/>
    <!-- Tunge (splittet) -->
    <path d="M190 80 L205 76 M190 80 L205 84" stroke="#E91E63" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M190 80 L200 80" stroke="#E91E63" stroke-width="2.5" stroke-linecap="round"/>
    <!-- Scale-dots langs kroppen -->
    <g fill="${darken(c.body, 25)}" opacity=".35">
      <circle cx="50" cy="100" r="2"/>
      <circle cx="65" cy="85" r="2"/>
      <circle cx="85" cy="80" r="2"/>
      <circle cx="105" cy="90" r="2"/>
      <circle cx="125" cy="105" r="2"/>
      <circle cx="145" cy="105" r="2"/>
    </g>
    ${tierBadge(c)}
  </svg>`;
}

function sheenDefs(c){
  if (c.tier === 'classic') return '';
  const id = c.id;
  switch (c.sheen){
    case 'gold': case 'silver': case 'bronze': case 'copper': case 'platinum': case 'titanium':
      return `<linearGradient id="sh_${id}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${lighten(c.body, 55)}" stop-opacity=".8"/>
        <stop offset=".5" stop-color="${c.body}" stop-opacity="0"/>
        <stop offset="1" stop-color="${lighten(c.body, 60)}" stop-opacity=".9"/>
      </linearGradient>`;
    case 'diamond':
      return `<linearGradient id="sh_${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".9"/>
        <stop offset=".5" stop-color="#80D8FF" stop-opacity=".6"/>
        <stop offset="1" stop-color="#B3E5FC" stop-opacity=".7"/>
      </linearGradient>`;
    case 'damascus':
      return `<pattern id="pat_${id}" x="0" y="0" width="24" height="8" patternUnits="userSpaceOnUse">
        <path d="M0 4 Q6 -1 12 4 T24 4" stroke="rgba(255,255,255,.3)" stroke-width="1" fill="none"/>
        <path d="M0 4 Q6 9 12 4 T24 4" stroke="rgba(0,0,0,.4)" stroke-width="1" fill="none"/>
      </pattern>`;
    case 'neon':
      return `<filter id="fl_${id}"><feGaussianBlur stdDeviation="1.5"/></filter>`;
    case 'hologram':
      return `<linearGradient id="sh_${id}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#FF80AB" stop-opacity=".6"/>
        <stop offset=".33" stop-color="#80DEEA" stop-opacity=".6"/>
        <stop offset=".66" stop-color="#FFF59D" stop-opacity=".6"/>
        <stop offset="1" stop-color="#CE93D8" stop-opacity=".6"/>
      </linearGradient>`;
    case 'cosmic':
      return `<radialGradient id="sh_${id}" cx=".5" cy=".5" r=".7">
        <stop offset="0" stop-color="#FFD700" stop-opacity=".4"/>
        <stop offset=".5" stop-color="#FF00FF" stop-opacity=".3"/>
        <stop offset="1" stop-color="#1A0066" stop-opacity=".1"/>
      </radialGradient>`;
    case 'obsidian':
      return `<linearGradient id="sh_${id}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#4527A0" stop-opacity=".4"/>
        <stop offset=".5" stop-color="#000000" stop-opacity="0"/>
        <stop offset="1" stop-color="#E91E63" stop-opacity=".4"/>
      </linearGradient>`;
    case 'ruby': case 'emerald': case 'sapphire': case 'amethyst':
    case 'topaz': case 'opal': case 'jade': case 'onyx': case 'citrine': case 'pearl':
      return `<radialGradient id="sh_${id}" cx=".4" cy=".3" r=".6">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".8"/>
        <stop offset="1" stop-color="${c.accent}" stop-opacity="0"/>
      </radialGradient>`;
  }
  return '';
}

function sheenStroke(c){
  if (c.tier === 'classic') return '';
  const id = c.id;
  if (c.sheen === 'neon'){
    return `<path d="M30 110 Q55 60, 100 90 Q145 120, 170 80" stroke="${c.accent}" stroke-width="34" stroke-linecap="round" fill="none" opacity=".5" filter="url(#fl_${id})"/>
      <path d="M30 110 Q55 60, 100 90 Q145 120, 170 80" stroke="${lighten(c.accent, 30)}" stroke-width="3" stroke-linecap="round" fill="none"/>`;
  }
  if (c.sheen === 'damascus'){
    return `<path d="M30 110 Q55 60, 100 90 Q145 120, 170 80" stroke="url(#pat_${id})" stroke-width="28" stroke-linecap="round" fill="none"/>`;
  }
  if (c.tier === 'legendary' || c.tier === 'metal' || c.tier === 'gem'){
    return `<path d="M30 110 Q55 60, 100 90 Q145 120, 170 80" stroke="url(#sh_${id})" stroke-width="16" stroke-linecap="round" fill="none" opacity=".7"/>`;
  }
  return '';
}

function tierBadge(c){
  if (c.tier === 'classic') return '';
  const map = {
    gem: { icon: '💎', color: '#40C4FF' },
    metal: { icon: '🏅', color: '#FFC107' },
    legendary: { icon: '👑', color: '#FFD700' }
  };
  const t = map[c.tier];
  if (!t) return '';
  return `<g transform="translate(20 30)">
    <circle r="13" fill="${t.color}" opacity=".9" stroke="#fff" stroke-width="2"/>
    <text text-anchor="middle" y="5" font-size="14">${t.icon}</text>
  </g>`;
}

// Material-config for 3D-rendering (tier-spesifikk)
export function getMaterialConfig(c){
  switch (c.tier){
    case 'classic':
      return { roughness: 0.55, metalness: 0.1, emissive: 0x000000, emissiveIntensity: 0 };
    case 'gem':
      return { roughness: 0.25, metalness: 0.2, emissive: c.accent, emissiveIntensity: 0.15 };
    case 'metal':
      return { roughness: 0.18, metalness: 0.85, emissive: 0x000000, emissiveIntensity: 0 };
    case 'legendary':
      return { roughness: 0.15, metalness: 0.5, emissive: c.accent, emissiveIntensity: 0.35, animated: true };
  }
}

function hex2rgb(h){
  const s = h.replace('#', '');
  return { r: parseInt(s.slice(0,2),16), g: parseInt(s.slice(2,4),16), b: parseInt(s.slice(4,6),16) };
}
function rgb2hex(r,g,b){
  return '#' + [r,g,b].map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2,'0')).join('');
}
function lighten(hex, pct){
  const { r, g, b } = hex2rgb(hex);
  const f = 1 + pct / 100;
  return rgb2hex(Math.min(255, r*f), Math.min(255, g*f), Math.min(255, b*f));
}
function darken(hex, pct){
  const { r, g, b } = hex2rgb(hex);
  const f = 1 - pct / 100;
  return rgb2hex(r*f, g*f, b*f);
}

// Eksporter helper som hex→int for Three.js
export function hexToInt(hex){
  return parseInt(hex.replace('#',''), 16);
}
