// public/avatars.js — deterministisk emoji + farge fra navn
const EMOJIS = ['🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦅','🦉','🦄','🐝','🦋','🐢','🦖','🦕','🐙','🦑','🦀','🦐','🐠','🐬','🦈','🐳','🦓','🦒','🦘','🦔','🦥','🦦','🐓','🐺','🐗','🐴','🐄','🐖','🐑','🦙','🐫','🐪','🦥','🦨','🦡'];

const COLORS = [
  '#ff5a6b','#ff9d4a','#ffcf4a','#f9de5b','#9ae053','#2fbf71','#3cc1d6','#5cc7ff',
  '#7a9bff','#b074ff','#e56bff','#ff5ab0','#ff7fa6','#ffb07f','#7fe3c4','#7fc3ff'
];

function hash(str){
  let h = 2166136261;
  for (let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function avatarFor(name){
  const h = hash(String(name||'?').toLowerCase());
  return {
    emoji: EMOJIS[h % EMOJIS.length],
    color: COLORS[(h >>> 8) % COLORS.length]
  };
}

export function colorFor(name){
  return avatarFor(name).color;
}

// Grid av valg-emojier for login
export const AVATAR_CHOICES = [
  '🦊','🐻','🐼','🐨','🐯','🦁','🐮',
  '🐷','🐸','🐵','🐔','🐧','🦄','🐝',
  '🦋','🐢','🦖','🐙','🦈','🐳','🦓',
  '🦒','🦘','🐔','🦉','🦅','🐗','🐺'
];
