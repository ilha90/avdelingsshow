// bomb3d.js — Three.js renderer for Bomberman
// Støtter både host (overview) og spiller (follow-camera) perspektiv
import * as THREE from 'three';

// Bloom-post-processing importeres dynamisk så det ikke kan krasje init hvis addons-CDN svikter
let EffectComposer = null, RenderPass = null, UnrealBloomPass = null;
let bloomLoaded = false;
async function loadBloomModules() {
  if (bloomLoaded) return;
  bloomLoaded = true;
  try {
    const [ec, rp, ubp] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
    ]);
    EffectComposer = ec.EffectComposer;
    RenderPass = rp.RenderPass;
    UnrealBloomPass = ubp.UnrealBloomPass;
    console.log('[bomb3d] bloom modules loaded');
  } catch (e) {
    console.warn('[bomb3d] bloom modules unavailable, fortsetter uten:', e?.message || e);
  }
}
// Start lasting i bakgrunnen (non-blocking)
loadBloomModules();

let renderer = null, scene = null, camera = null, composer = null;
let wallMeshes = [], crateMeshes = new Map();
let bombMeshes = new Map(), playerMeshes = new Map(), powerupMeshes = new Map();
let explosionObjects = [];
let floorGroup = null;
let gridW = 0, gridH = 0;
let lastWallsVersion = -1;

// Kamera-modi
let cameraMode = 'overview'; // 'overview' | 'follow'
let followPlayerId = null;
let followZoom = 1.0; // 0.5 = mer zoom inn, 2.0 = mer zoom ut
// Kill-cam state
let killCamUntil = 0;
let killCamTarget = null;
// Glatt kamera-interpolasjon
const cameraTarget = new THREE.Vector3();
const cameraLookAt = new THREE.Vector3();
const tmpLookAt = new THREE.Vector3();

const MAT = {
  floorA: new THREE.MeshStandardMaterial({ color: 0x25422e, roughness: 0.95 }),
  floorB: new THREE.MeshStandardMaterial({ color: 0x1a2f22, roughness: 0.95 }),
  wall:   new THREE.MeshStandardMaterial({ color: 0x6e6e7a, roughness: 0.6, metalness: 0.15 }),
  crate:  new THREE.MeshStandardMaterial({ color: 0xa8672f, roughness: 0.9 }),
  bomb:   new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.35, metalness: 0.3 }),
  fuse:   new THREE.MeshBasicMaterial({ color: 0xffb040 }),
  skin:   new THREE.MeshStandardMaterial({ color: 0xffdcb0, roughness: 0.55, metalness: 0.0 }),
  belt:   new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.7, metalness: 0.1 }),
};

const PU_COLOR = {
  bomb:   0xe54b4b, range: 0xffbe0b, shield: 0x3a86ff, gold: 0xd4af37,
  speed:  0xa855f7, kick: 0x3ae49b, punch: 0xff6b9e, remote: 0x6bcfff,
};

export function init(canvas, gW, gH, options = {}) {
  gridW = gW; gridH = gH;
  cameraMode = options.cameraMode || 'overview';
  followPlayerId = options.followPlayerId || null;
  if (renderer) dispose();

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  resize();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c141b);
  scene.fog = new THREE.Fog(0x0c141b, 30, 80);

  camera = new THREE.PerspectiveCamera(48, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 200);
  setCameraTargetInstant();

  scene.add(new THREE.AmbientLight(0xfff0dd, 0.6));
  const sun = new THREE.DirectionalLight(0xfff3d6, 0.95);
  const cx = gW / 2, cz = gH / 2;
  sun.position.set(cx - gW * 0.5, gH * 1.5, cz - gH * 0.2);
  sun.target.position.set(cx, 0, cz);
  scene.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
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

  // === Post-processing: bloom for glødende ting (explosions, powerups, LED) ===
  // Initialiseres kun hvis modulene er lastet (fallback til vanlig render ellers)
  composer = null;
  if (EffectComposer && RenderPass && UnrealBloomPass) {
    try {
      composer = new EffectComposer(renderer);
      composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      composer.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
        0.7,   // strength
        0.55,  // radius
        0.4    // threshold
      );
      composer.addPass(bloom);
    } catch (e) {
      console.warn('[bomb3d] kunne ikke sette opp bloom:', e?.message || e);
      composer = null;
    }
  }
  // Initialiser shake og shockwave-states
  shakeUntil = 0; shakeIntensity = 0;
  shockwaves = [];
  lastExplosionCount = 0;
}

// Screen shake state
let shakeUntil = 0;
let shakeIntensity = 0;
const shakeOffset = new THREE.Vector3();
function triggerShake(intensity = 0.5, durationMs = 300) {
  shakeUntil = Math.max(shakeUntil, Date.now() + durationMs);
  shakeIntensity = Math.max(shakeIntensity, intensity);
}

// Shockwave-ringer (ekspanderende)
let shockwaves = [];
let lastExplosionCount = 0;
function spawnShockwave(x, y) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.4, 32),
    new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x + 0.5, 0.12, y + 0.5);
  scene.add(ring);
  shockwaves.push({ mesh: ring, bornAt: Date.now(), duration: 550 });
}

export function setCameraMode(mode, followId = null) {
  cameraMode = mode;
  followPlayerId = followId;
}

export function setZoom(z) {
  followZoom = Math.max(0.4, Math.min(3.0, z));
}
export function getZoom() { return followZoom; }

export function triggerKillCam(x, y, durationMs = 2500) {
  killCamTarget = { x, y };
  killCamUntil = Date.now() + durationMs;
}

function setCameraTargetInstant() {
  computeCameraTarget();
  camera.position.copy(cameraTarget);
  camera.lookAt(cameraLookAt);
}

function computeCameraTarget() {
  const cx = gridW / 2, cz = gridH / 2;
  const now = Date.now();
  if (now < killCamUntil && killCamTarget) {
    cameraTarget.set(killCamTarget.x + 0.5 + 2.5, 5, killCamTarget.y + 0.5 + 3.5);
    cameraLookAt.set(killCamTarget.x + 0.5, 0.5, killCamTarget.y + 0.5);
    return;
  }
  if (cameraMode === 'follow' && followPlayerId) {
    const obj = playerMeshes.get(followPlayerId);
    if (obj) {
      const p = obj.group.position;
      // Lengre unna — viser større oversikt rundt spilleren
      const baseY = 11, baseZ = 9;
      cameraTarget.set(p.x, baseY * followZoom, p.z + baseZ * followZoom);
      cameraLookAt.set(p.x, 0, p.z - 0.5);
      return;
    }
  }
  // Overview
  cameraTarget.set(cx, Math.max(gridH * 1.0, 14), gridH + 7);
  cameraLookAt.set(cx, 0, cz - 1);
}

function resize() {
  if (!renderer) return;
  const canvas = renderer.domElement;
  const parent = canvas.parentElement;
  if (!parent) return;
  const w = parent.clientWidth, h = parent.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  if (composer) composer.setSize(w, h);
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
        m.receiveShadow = true;
        // Ingen castShadow — mindre rot mellom bokser
        scene.add(m); wallMeshes.push(m);
      } else if (v === 2) {
        const m = new THREE.Mesh(crateGeom, MAT.crate);
        m.position.set(x + 0.5, 0.45, y + 0.5);
        m.receiveShadow = true;
        // Ingen castShadow på kasser heller
        scene.add(m); crateMeshes.set(x + ',' + y, m);
      }
    }
  }
  lastWallsVersion = version;
}

const labelCache = new Map();
function getEmojiLabel(emoji) {
  const key = emoji || '';
  if (labelCache.has(key)) return labelCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.font = '96px system-ui, Apple Color Emoji, Segoe UI Emoji';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(emoji || '😀', 64, 72);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  labelCache.set(key, tex);
  return tex;
}

// Bomberman-karakter (hode, hjelm, kropp, belte, emoji-billboard)
function createBombermanCharacter(color, emoji) {
  const group = new THREE.Group();
  const colorObj = new THREE.Color(color);

  // Kropp — rundet kapsel
  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorObj, roughness: 0.45, metalness: 0.1,
    emissive: colorObj, emissiveIntensity: 0.1,
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.18, 6, 14), bodyMat);
  body.position.y = 0.42;
  body.castShadow = true;
  group.add(body);

  // Belte (liten sylinder)
  const belt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.28, 0.07, 16),
    MAT.belt
  );
  belt.position.y = 0.42;
  group.add(belt);

  // Hode — liten kule (ansikt)
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 18, 14),
    MAT.skin
  );
  head.position.y = 0.85;
  head.castShadow = true;
  group.add(head);

  // Hjelm — halvkule oppå hodet
  const helmetMat = new THREE.MeshStandardMaterial({
    color: colorObj, roughness: 0.3, metalness: 0.3,
    emissive: colorObj, emissiveIntensity: 0.18,
  });
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.23, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    helmetMat
  );
  helmet.position.y = 0.90;
  helmet.castShadow = true;
  group.add(helmet);

  // Antenne på toppen
  const antStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6),
    MAT.belt
  );
  antStem.position.y = 1.15;
  group.add(antStem);
  const antTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: 0xffaa00, emissiveIntensity: 0.8 })
  );
  antTip.position.y = 1.22;
  group.add(antTip);

  // Emoji-etikett over hodet
  const labelTex = getEmojiLabel(emoji);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false })
  );
  label.position.y = 1.55;
  group.add(label);

  return { group, body, head, helmet, label, bodyMat, helmetMat };
}

function updatePlayer(p) {
  let obj = playerMeshes.get(p.id);
  if (!obj) {
    obj = createBombermanCharacter(p.color, p.emoji);
    obj.shield = null;
    scene.add(obj.group);
    playerMeshes.set(p.id, obj);
    // Sett initial posisjon
    obj.group.position.set(p.x + 0.5, 0, p.y + 0.5);
    obj._targetX = p.x + 0.5;
    obj._targetZ = p.y + 0.5;
  }
  // Sett target — faktisk interpolasjon skjer i render() hver frame
  obj._targetX = p.x + 0.5;
  obj._targetZ = p.y + 0.5;

  obj.group.visible = p.alive || p.respawnIn > 0;
  const alpha = p.alive ? 1 : 0.35;
  obj.bodyMat.opacity = alpha;
  obj.bodyMat.transparent = !p.alive;
  obj.helmetMat.opacity = alpha;
  obj.helmetMat.transparent = !p.alive;

  // Skjold-ring
  if (p.shield > 0 && !obj.shield) {
    const shield = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.05, 10, 28),
      new THREE.MeshBasicMaterial({ color: 0x7ed4ff, transparent: true, opacity: 0.8 })
    );
    shield.rotation.x = Math.PI / 2;
    shield.position.y = 0.42;
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

  if (bombSnap.walls && bombSnap.wallsVersion !== lastWallsVersion) {
    rebuildWalls(bombSnap.walls, bombSnap.wallsVersion);
  } else if (bombSnap.walls) {
    for (const [key, mesh] of crateMeshes) {
      const [x, y] = key.split(',').map(Number);
      if (bombSnap.walls[y * gridW + x] !== 2) {
        scene.remove(mesh);
        crateMeshes.delete(key);
      }
    }
  }

  // Spillere
  const seenPids = new Set();
  for (const p of bombSnap.players) { updatePlayer(p); seenPids.add(p.id); }
  for (const [pid, o] of playerMeshes) if (!seenPids.has(pid)) { scene.remove(o.group); playerMeshes.delete(pid); }

  // Label billboards mot kameraet
  for (const o of playerMeshes.values()) {
    if (o.label && camera) o.label.lookAt(camera.position);
  }

  // Bomber (keyed by id så mesh er stabil selv når bomben sprettes/kastes/holdes)
  const seenBombs = new Set();
  for (const b of bombSnap.bombs) {
    const key = b.id != null ? ('id:' + b.id) : (b.x + ',' + b.y);
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
      scene.add(group);
      obj = { group, body, fuse, spark };
      bombMeshes.set(key, obj);
    }
    // Posisjon — held bombe holdes over hodet
    const targetY = b.held ? 1.55 : 0;
    obj.group.position.set(b.x + 0.5, targetY, b.y + 0.5);
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
      const pointLight = new THREE.PointLight(PU_COLOR[u.type] || 0xffffff, 0.5, 2.2);
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

  // Eksplosjoner + detekter nye for shockwave/shake
  if (bombSnap.explosions.length > lastExplosionCount) {
    triggerShake(0.45, 320);
    // Spawn shockwave på alle nye eksplosjoner (nyeste er de som har høyest tLeft)
    const newExplosions = bombSnap.explosions.slice(lastExplosionCount);
    for (const e of newExplosions) spawnShockwave(e.x, e.y);
  }
  lastExplosionCount = bombSnap.explosions.length;
  for (const o of explosionObjects) scene.remove(o);
  explosionObjects = [];
  for (const e of bombSnap.explosions) {
    const f = Math.max(0, e.tLeft / 700);
    const scale = 0.3 + (1 - f) * 0.65;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(scale, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffaa30, transparent: true, opacity: f * 0.85 })
    );
    mesh.position.set(e.x + 0.5, 0.5, e.y + 0.5);
    scene.add(mesh);
    explosionObjects.push(mesh);
    const light = new THREE.PointLight(0xff8030, 2.5 * f, 3);
    light.position.copy(mesh.position);
    scene.add(light);
    explosionObjects.push(light);
  }
}

export function render() {
  if (!renderer || !scene || !camera) return;
  // Smooth per-frame animasjon for spillerposisjoner + rotasjon
  for (const obj of playerMeshes.values()) {
    if (obj._targetX == null) continue;
    const tx = obj._targetX, tz = obj._targetZ;
    const dx = tx - obj.group.position.x;
    const dz = tz - obj.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.001) {
      // Lerp-faktor 0.2 gir glatt interpolasjon over en server-tick (~180ms @ 60fps)
      const step = 0.22;
      obj.group.position.x += dx * step;
      obj.group.position.z += dz * step;
      // Snap ved stor avstand (respawn/initial)
      if (dist > 3) {
        obj.group.position.x = tx;
        obj.group.position.z = tz;
      }
      // Roter mot bevegelsesretning
      if (dist > 0.02) {
        const targetAngle = Math.atan2(dx, dz);
        let diff = targetAngle - obj.group.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        obj.group.rotation.y += diff * 0.25;
      }
    }
  }
  // Oppdater kamera (glatt følge / killcam / overview)
  computeCameraTarget();
  camera.position.lerp(cameraTarget, 0.15);
  tmpLookAt.lerp(cameraLookAt, 0.2);
  camera.lookAt(tmpLookAt);
  // Screen shake (additiv offset over kamera-lerp)
  const now = Date.now();
  if (now < shakeUntil) {
    const remaining = (shakeUntil - now) / 300;
    const amp = shakeIntensity * Math.max(0, Math.min(1, remaining));
    shakeOffset.set(
      (Math.random() - 0.5) * amp,
      (Math.random() - 0.5) * amp,
      (Math.random() - 0.5) * amp
    );
    camera.position.add(shakeOffset);
  } else {
    shakeIntensity = 0;
  }
  // Shockwave-ringer ekspanderer og fader
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const sw = shockwaves[i];
    const t = (now - sw.bornAt) / sw.duration;
    if (t >= 1) {
      scene.remove(sw.mesh);
      sw.mesh.geometry.dispose();
      sw.mesh.material.dispose();
      shockwaves.splice(i, 1);
      continue;
    }
    const scale = 1 + t * 6;
    sw.mesh.scale.set(scale, scale, scale);
    sw.mesh.material.opacity = 0.9 * (1 - t);
  }
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

export function dispose() {
  if (!renderer) return;
  renderer.dispose();
  if (composer) { composer.dispose?.(); composer = null; }
  renderer = null;
  scene = null;
  camera = null;
  wallMeshes = [];
  crateMeshes.clear();
  bombMeshes.clear();
  playerMeshes.clear();
  powerupMeshes.clear();
  explosionObjects = [];
  shockwaves = [];
  lastExplosionCount = 0;
  shakeUntil = 0; shakeIntensity = 0;
  lastWallsVersion = -1;
  killCamUntil = 0;
  killCamTarget = null;
  labelCache.clear();
}
