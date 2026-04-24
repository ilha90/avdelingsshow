// avatars.js — konsistente emoji-avatarer basert på navn
export const AVATAR_POOL = [
  '🦊','🐼','🐨','🐻','🦁','🐯','🐸','🐙','🦉','🦄',
  '🐲','🦋','🐞','🐢','🦖','🦕','🦎','🐍','🦅','🦜',
  '🐺','🦝','🐹','🐰','🦘','🦒','🐘','🦏','🐧','🐢',
  '🐬','🦈','🐠','🦀','🦞','🐙','🦑','🪼','🐳','🦦',
  '🌵','🌻','🌺','🌸','🍄','🌲','⭐','🌈','🔥','⚡',
];

export function avatarFor(name) {
  const s = String(name || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return AVATAR_POOL[Math.abs(h) % AVATAR_POOL.length];
}

export function colorFor(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 70%, 58%)`;
}
