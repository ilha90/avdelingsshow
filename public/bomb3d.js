// bomb3d.js — Three.js renderer for Bomberman
import * as THREE from 'three';

let renderer = null, scene = null, camera = null;
let wallMeshes = [], crateMeshes = new Map();
let bombMeshes = new Map(), playerMeshes = new Map(), powerupMeshes = new Map();
let explosionObjects = [];
let floorGroup = null;
let gridW = 0, gridH = 0;
let lastWallsVersion = -1;

const MAT = {
  floorA: new THREE.MeshStandardMaterial({ color: 0x25422e, roughness: 0.95 }),
  floorB: new THREE.MeshStandardMaterial({ color: 0x1a2f22, roughness: 0.95 }),
  wall:   new THREE.MeshStandardMaterial({ color: 0x6e6e7a, roughness: 0.6, metalness: 0.15 }),
  crate:  new THREE.MeshStandardMaterial({ color: 0xa8672f, roughness: 0.9 }),
  bomb:   new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.35, metalness: 0.3 }),
  fuse:   new THREE.MeshBasicMaterial({ color: 0xffb040 }),
};

const PU_COLOR = { bomb: 0xe54b4b, range: 0xffbe0b, shield: 0x3a86ff, gold: 0xd4af37 };

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
  scene.background = new THREE.Color(0x0c141b);
  scene.fog = new THREE.Fog(0x0c141b, 30, 70);

  const cx = gW / 2, cz = gH / 2;
  camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 200);
  camera.position.set(cx, Math.max(gH * 1.0, 14), gH + 7);
  camera.lookAt(cx, 0, cz - 1);

  scene.add(new THREE.AmbientLight(0xfff0dd, 0.55));
  const sun = new THREE.DirectionalLight(0xfff3d6, 1.0);
  sun.position.set(cx - gW * 0.6, gH * 1.5, cz - gH * 0.3);
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

  // Floor (sjakkrutet)
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

function rebuildWalls(walls, version) {
  for (const m of wallMeshes) scene.remove(m);
  wallMeshes = [];
  for (const m of crateMeshes.values()) scene.remove(m);
  crateMeshes.clear();

  const wallGeom = new THREE.BoxGeometry(1, 1, 1);
  const crateGeom = new THREE.BoxGeometry(0.92, 0.9, 0.92);

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const v = walls[y * gridW + x];
      if (v === 1) {
        const m = new THREE.Mesh(wallGeom, MAT.wall);
        m.position.set(x + 0.5, 0.5, y + 0.5);
        m.castShadow = true; m.receiveShadow = true;
        scene.add(m); wallMeshes.push(m);
      } else if (v === 2) {
        const m = new THREE.Mesh(crateGeom, MAT.crate);
        m.position.set(x + 0.5, 0.45, y + 0.5);
        m.castShadow = true; m.receiveShadow = true;
        scene.add(m); crateMeshes.set(x + ',' + y, m);
      }
    }
  }
  lastWallsVersion = version;
}

const labelCache = new Map();
function getEmojiLabel(emoji, color) {
  const key = (emoji || '') + '|' + color;
  if (labelCache.has(key)) return labelCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const ctx = cv.getContext('2d');
  // Ring
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.stroke();
  // Emoji
  ctx.font = '80px system-ui, Apple Color Emoji, Segoe UI Emoji';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(emoji || '😀', 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  labelCache.set(key, tex);
  return tex;
}

function updatePlayer(p) {
  let obj = playerMeshes.get(p.id);
  if (!obj) {
    const group = new THREE.Group();
    // Body — kule
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 20, 16),
      new THREE.MeshStandardMaterial({
        color: p.color, roughness: 0.4, metalness: 0.1,
        emissive: new THREE.Color(p.color), emissiveIntensity: 0.15,
      })
    );
    body.position.y = 0.4;
    body.castShadow = true;
    group.add(body);
    // Emoji billboard over hodet
    const labelTex = getEmojiLabel(p.emoji, p.color);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.75, 0.75),
      new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false })
    );
    label.position.y = 1.2;
    group.add(label);
    scene.add(group);
    obj = { group, body, label, shield: null };
    playerMeshes.set(p.id, obj);
  }
  obj.group.position.set(p.x + 0.5, 0, p.y + 0.5);
  obj.group.visible = p.alive || p.respawnIn > 0;
  obj.body.material.opacity = p.alive ? 1 : 0.25;
  obj.body.material.transparent = !p.alive;
  obj.label.material.opacity = p.alive ? 1 : 0.25;
  // Shield-ring
  if (p.shield > 0 && !obj.shield) {
    const shield = new THREE.Mesh(
      new THREE.TorusGeometry(0.48, 0.06, 10, 28),
      new THREE.MeshBasicMaterial({ color: 0x7ed4ff, transparent: true, opacity: 0.75 })
    );
    shield.rotation.x = Math.PI / 2;
    shield.position.y = 0.4;
    obj.group.add(shield);
    obj.shield = shield;
  } else if (p.shield === 0 && obj.shield) {
    obj.group.remove(obj.shield);
    obj.shield = null;
  }
}

export function update(bombSnap) {
  if (!bombSnap || !scene) return;
  resize();

  // Walls/crates
  if (bombSnap.walls && bombSnap.wallsVersion !== lastWallsVersion) {
    rebuildWalls(bombSnap.walls, bombSnap.wallsVersion);
  } else if (bombSnap.walls) {
    // Removed crates (quick check each update)
    for (const [key, mesh] of crateMeshes) {
      const [x, y] = key.split(',').map(Number);
      if (bombSnap.walls[y * gridW + x] !== 2) {
        scene.remove(mesh);
        crateMeshes.delete(key);
      }
    }
  }

  // Players
  const seenPids = new Set();
  for (const p of bombSnap.players) { updatePlayer(p); seenPids.add(p.id); }
  for (const [pid, o] of playerMeshes) if (!seenPids.has(pid)) { scene.remove(o.group); playerMeshes.delete(pid); }

  // Make emoji labels face camera
  for (const o of playerMeshes.values()) {
    if (o.label && camera) o.label.lookAt(camera.position);
  }

  // Bombs
  const seenBombs = new Set();
  for (const b of bombSnap.bombs) {
    const key = b.x + ',' + b.y;
    seenBombs.add(key);
    let obj = bombMeshes.get(key);
    if (!obj) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 16), MAT.bomb);
      body.position.y = 0.34;
      body.castShadow = true;
      group.add(body);
      const fuse = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6), MAT.fuse);
      fuse.position.y = 0.75;
      group.add(fuse);
      const spark = new THREE.PointLight(0xffa040, 1.2, 2);
      spark.position.y = 0.85;
      group.add(spark);
      group.position.set(b.x + 0.5, 0, b.y + 0.5);
      scene.add(group);
      obj = { group, body, fuse, spark };
      bombMeshes.set(key, obj);
    }
    const f = Math.max(0, b.tLeft / 2500);
    const pulse = 1 + 0.15 * Math.sin(Date.now() / (100 + f * 300));
    obj.body.scale.setScalar(pulse);
    obj.spark.intensity = 0.8 + 0.6 * Math.sin(Date.now() / 60);
  }
  for (const [key, o] of bombMeshes) if (!seenBombs.has(key)) { scene.remove(o.group); bombMeshes.delete(key); }

  // Powerups
  const seenPu = new Set();
  const t = Date.now() / 500;
  for (const u of bombSnap.powerups) {
    const key = u.x + ',' + u.y;
    seenPu.add(key);
    let obj = powerupMeshes.get(key);
    if (!obj) {
      const group = new THREE.Group();
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.3, 0),
        new THREE.MeshStandardMaterial({
          color: PU_COLOR[u.type] || 0xffffff,
          emissive: PU_COLOR[u.type] || 0xffffff,
          emissiveIntensity: 0.6,
          roughness: 0.15, metalness: 0.6,
        })
      );
      gem.position.y = 0.55;
      gem.castShadow = true;
      group.add(gem);
      const pointLight = new THREE.PointLight(PU_COLOR[u.type] || 0xffffff, 0.6, 2.5);
      pointLight.position.y = 0.55;
      group.add(pointLight);
      group.position.set(u.x + 0.5, 0, u.y + 0.5);
      scene.add(group);
      obj = { group, gem };
      powerupMeshes.set(key, obj);
    }
    obj.gem.rotation.y = t;
    obj.gem.position.y = 0.55 + Math.sin(t * 1.5) * 0.08;
  }
  for (const [key, o] of powerupMeshes) if (!seenPu.has(key)) { scene.remove(o.group); powerupMeshes.delete(key); }

  // Explosions — rekreeres hver update (kortvarige)
  for (const o of explosionObjects) scene.remove(o);
  explosionObjects = [];
  for (const e of bombSnap.explosions) {
    const f = Math.max(0, e.tLeft / 700);
    const scale = 0.3 + (1 - f) * 0.65;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(scale, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffaa30, transparent: true, opacity: f * 0.85 })
    );
    mesh.position.set(e.x + 0.5, 0.4, e.y + 0.5);
    scene.add(mesh);
    explosionObjects.push(mesh);
    const light = new THREE.PointLight(0xff8030, 2.5 * f, 3);
    light.position.copy(mesh.position);
    scene.add(light);
    explosionObjects.push(light);
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
  wallMeshes = [];
  crateMeshes.clear();
  bombMeshes.clear();
  playerMeshes.clear();
  powerupMeshes.clear();
  explosionObjects = [];
  lastWallsVersion = -1;
  labelCache.clear();
}
