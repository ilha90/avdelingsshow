// snake3d.js — Three.js renderer for Snake
import * as THREE from 'three';

let renderer = null, scene = null, camera = null;
let floorGroup = null, borderGroup = null;
let snakeMeshes = new Map(); // pid -> { group, segments: [mesh...], head, color }
let foodMeshes = [];
let gridW = 0, gridH = 0;

const MAT = {
  floorA: new THREE.MeshStandardMaterial({ color: 0x0f1722, roughness: 0.95 }),
  floorB: new THREE.MeshStandardMaterial({ color: 0x131c29, roughness: 0.95 }),
  border: new THREE.MeshStandardMaterial({ color: 0x2a3444, roughness: 0.6, metalness: 0.3 }),
  food:   new THREE.MeshStandardMaterial({
    color: 0xffd95c, emissive: 0xffa920, emissiveIntensity: 0.8,
    roughness: 0.2, metalness: 0.3,
  }),
};

export function init(canvas, gW, gH) {
  gridW = gW; gridH = gH;
  if (renderer) dispose();

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  resize();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060a11);
  scene.fog = new THREE.Fog(0x060a11, 35, 80);

  const cx = gW / 2, cz = gH / 2;
  camera = new THREE.PerspectiveCamera(42, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 250);
  camera.position.set(cx, Math.max(gH * 1.0, 22), gH + 8);
  camera.lookAt(cx, 0, cz - 1);

  scene.add(new THREE.AmbientLight(0xe0e8ff, 0.5));
  const sun = new THREE.DirectionalLight(0xfff3d6, 0.95);
  sun.position.set(cx - gW * 0.4, gH * 1.4, cz - gH * 0.4);
  sun.target.position.set(cx, 0, cz);
  scene.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -gW * 0.7;
  sun.shadow.camera.right = gW * 0.7;
  sun.shadow.camera.top = gH * 0.7;
  sun.shadow.camera.bottom = -gH * 0.7;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = gH * 3;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // Gulv — sjakkrutet
  floorGroup = new THREE.Group();
  const tileGeom = new THREE.PlaneGeometry(1, 1);
  for (let y = 0; y < gH; y++) {
    for (let x = 0; x < gW; x++) {
      const mat = (x + y) % 2 === 0 ? MAT.floorA : MAT.floorB;
      const t = new THREE.Mesh(tileGeom, mat);
      t.rotation.x = -Math.PI / 2;
      t.position.set(x + 0.5, 0, y + 0.5);
      t.receiveShadow = true;
      floorGroup.add(t);
    }
  }
  scene.add(floorGroup);

  // Ramme-vegger rundt brettet
  borderGroup = new THREE.Group();
  const borderGeom = new THREE.BoxGeometry(1, 0.6, 1);
  for (let x = -1; x <= gW; x++) {
    for (const z of [-1, gH]) {
      const m = new THREE.Mesh(borderGeom, MAT.border);
      m.position.set(x + 0.5, 0.3, z + 0.5);
      m.castShadow = true; m.receiveShadow = true;
      borderGroup.add(m);
    }
  }
  for (let z = 0; z < gH; z++) {
    for (const x of [-1, gW]) {
      const m = new THREE.Mesh(borderGeom, MAT.border);
      m.position.set(x + 0.5, 0.3, z + 0.5);
      m.castShadow = true; m.receiveShadow = true;
      borderGroup.add(m);
    }
  }
  scene.add(borderGroup);
}

function resize() {
  if (!renderer) return;
  const canvas = renderer.domElement;
  const parent = canvas.parentElement;
  if (!parent) return;
  const w = parent.clientWidth, h = parent.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  if (camera) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

const labelCache = new Map();
function getEmojiLabel(emoji, color) {
  const key = (emoji || '') + '|' + color;
  if (labelCache.has(key)) return labelCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.stroke();
  ctx.font = '80px system-ui, Apple Color Emoji, Segoe UI Emoji';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(emoji || '🐍', 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  labelCache.set(key, tex);
  return tex;
}

function ensureSnake(s) {
  let obj = snakeMeshes.get(s.id || s.name); // fallback to name since snake uses name
  const key = s.id || s.name;
  if (!obj) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: s.color, roughness: 0.35, metalness: 0.15,
      emissive: new THREE.Color(s.color), emissiveIntensity: 0.25,
    });
    // Label over hodet
    const labelTex = getEmojiLabel(s.emoji, s.color);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false })
    );
    label.position.y = 1.5;
    group.add(label);
    scene.add(group);
    obj = { group, label, segments: [], mat };
    snakeMeshes.set(key, obj);
  }
  return obj;
}

function updateSnakeSegments(obj, body, alive, isHead) {
  // Fjern overflødig
  while (obj.segments.length > body.length) {
    const m = obj.segments.pop();
    obj.group.remove(m);
  }
  // Legg til nye
  while (obj.segments.length < body.length) {
    const isFirst = obj.segments.length === 0;
    const geom = isFirst
      ? new THREE.SphereGeometry(0.42, 16, 14)
      : new THREE.SphereGeometry(0.36, 14, 12);
    const m = new THREE.Mesh(geom, obj.mat);
    m.castShadow = true;
    obj.group.add(m);
    obj.segments.push(m);
  }
  // Oppdater posisjoner
  for (let i = 0; i < body.length; i++) {
    const seg = body[i];
    obj.segments[i].position.set(seg.x + 0.5, i === 0 ? 0.45 : 0.38, seg.y + 0.5);
  }
  obj.mat.opacity = alive ? 1 : 0.25;
  obj.mat.transparent = !alive;
  obj.mat.emissiveIntensity = alive ? 0.25 : 0.05;
  // Label over hodet
  if (body.length > 0 && obj.label) {
    const head = body[0];
    obj.label.position.set(head.x + 0.5, 1.5, head.y + 0.5);
  }
  obj.group.visible = body.length > 0;
}

export function update(snakeSnap) {
  if (!snakeSnap || !scene) return;
  resize();

  // Snakes
  const seen = new Set();
  for (const s of snakeSnap.snakes) {
    const key = s.id || s.name;
    seen.add(key);
    const obj = ensureSnake(s);
    updateSnakeSegments(obj, s.body || [], s.alive);
  }
  for (const [key, o] of snakeMeshes) {
    if (!seen.has(key)) {
      scene.remove(o.group);
      snakeMeshes.delete(key);
    }
  }
  // Label billboards følger kameraet
  for (const o of snakeMeshes.values()) {
    if (o.label && camera) o.label.lookAt(camera.position);
  }

  // Food — rebuild hver update (lite antall, enkelt)
  for (const m of foodMeshes) scene.remove(m);
  foodMeshes = [];
  const t = Date.now() / 400;
  for (const f of snakeSnap.food || []) {
    const g = new THREE.Group();
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 16, 12),
      MAT.food
    );
    const bob = Math.sin(t + f.x * 0.3 + f.y * 0.2) * 0.1;
    sphere.position.y = 0.45 + bob;
    sphere.castShadow = true;
    g.add(sphere);
    const light = new THREE.PointLight(0xffb040, 0.6, 2);
    light.position.y = 0.5;
    g.add(light);
    g.position.set(f.x + 0.5, 0, f.y + 0.5);
    scene.add(g);
    foodMeshes.push(g);
  }
}

export function render() {
  if (renderer && scene && camera) renderer.render(scene, camera);
}

export function dispose() {
  if (!renderer) return;
  renderer.dispose();
  renderer = null;
  scene = null;
  camera = null;
  snakeMeshes.clear();
  foodMeshes = [];
  labelCache.clear();
}
