// public/snake3d.js — Three.js Snake-scene

import * as THREE from 'three';
import { colorFor } from './avatars.js';
import { SNAKE_CHARS, getSnakeChar, getMaterialConfig, hexToInt } from './snake-chars.js';

const COLS = 40;
const ROWS = 25;
const CELL = 1;

function hexToIntSafe(v){
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseInt(v.replace('#',''), 16);
  return 0xffffff;
}

export class SnakeRenderer {
  constructor(canvas){
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x061611, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x061611, 35, 90);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
    this.camera.position.set(COLS/2, 50, ROWS*1.3);
    this.camera.lookAt(COLS/2, 0, ROWS/2);

    // Lights
    this.scene.add(new THREE.AmbientLight(0xaabbcc, 0.45));
    const sun = new THREE.DirectionalLight(0xfff1c0, 1.1);
    sun.position.set(30, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -30; sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -20;
    this.scene.add(sun);

    // Ground
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(COLS*2, ROWS*2),
      new THREE.MeshStandardMaterial({ color: 0x0f3225, roughness: 0.95 })
    );
    g.rotation.x = -Math.PI/2;
    g.position.set(COLS/2, 0, ROWS/2);
    g.receiveShadow = true;
    this.scene.add(g);

    // Grid tiles
    const tileGeo = new THREE.PlaneGeometry(CELL*0.96, CELL*0.96);
    const matLight = new THREE.MeshStandardMaterial({ color: 0x143b2d, roughness: 1 });
    const matDark = new THREE.MeshStandardMaterial({ color: 0x0c2a20, roughness: 1 });
    for (let x=0;x<COLS;x++){
      for (let z=0;z<ROWS;z++){
        const m = new THREE.Mesh(tileGeo, (x+z) % 2 === 0 ? matLight : matDark);
        m.rotation.x = -Math.PI/2;
        m.position.set(x + 0.5, 0.01, z + 0.5);
        this.scene.add(m);
      }
    }

    // Walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x47D197, emissive: 0x072a1d, roughness: .4 });
    const wb = new THREE.BoxGeometry(COLS + 1, 1.2, 0.6);
    const ws = new THREE.BoxGeometry(0.6, 1.2, ROWS + 1);
    const w1 = new THREE.Mesh(wb, wallMat); w1.position.set(COLS/2, 0.6, -0.3); this.scene.add(w1);
    const w2 = new THREE.Mesh(wb, wallMat); w2.position.set(COLS/2, 0.6, ROWS + 0.3); this.scene.add(w2);
    const w3 = new THREE.Mesh(ws, wallMat); w3.position.set(-0.3, 0.6, ROWS/2); this.scene.add(w3);
    const w4 = new THREE.Mesh(ws, wallMat); w4.position.set(COLS + 0.3, 0.6, ROWS/2); this.scene.add(w4);

    // Groups
    this.snakeGroup = new THREE.Group();
    this.foodGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.trailGroup = new THREE.Group();
    this.scene.add(this.snakeGroup);
    this.scene.add(this.foodGroup);
    this.scene.add(this.trailGroup);
    this.scene.add(this.fxGroup);

    // Internal
    this.segMeshes = new Map();
    this.prevFoodKeys = new Set();
    this.prevAliveIds = new Set();
    this.prevHeadPos = new Map(); // id -> {x, z} for trail spawning
    this.prevState = null;
    this.curState = null;
    this.interpT = 1;
    this.tickMs = 140;

    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', () => setTimeout(this.onResize, 120));
    this.onResize();

    this.running = true;
    this.loop = this.loop.bind(this);
    this.loop();
  }

  onResize(){
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width|0);
    const h = Math.max(1, r.height|0);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w/h;
    this.camera.updateProjectionMatrix();
  }

  setState(state){
    this.prevState = this.curState;
    this.curState = state;
    this.interpT = 0;
    this.lastTickTime = performance.now();

    // ===== Mat — spawn spark ved borte-mat =====
    const newFoodKeys = new Set((state.food || []).map(f => f.x + ':' + f.y));
    for (const k of this.prevFoodKeys){
      if (!newFoodKeys.has(k)){
        const [fx, fy] = k.split(':').map(Number);
        this.spawnFoodSparks(fx, fy);
      }
    }
    this.prevFoodKeys = newFoodKeys;

    // ===== Mat-meshes =====
    this.foodGroup.clear();
    const foodGeo = new THREE.SphereGeometry(0.35, 16, 12);
    const foodMat = new THREE.MeshStandardMaterial({ color: 0xffcf4a, emissive: 0xCAAB51, emissiveIntensity: 0.7, roughness: 0.3 });
    for (const f of (state.food || [])){
      const m = new THREE.Mesh(foodGeo, foodMat);
      m.position.set(f.x + 0.5, 0.5 + 0.12 * Math.sin(performance.now()*0.002 + f.x + f.y), f.y + 0.5);
      m.castShadow = true;
      this.foodGroup.add(m);
    }

    // ===== Snakes =====
    const currentAliveIds = new Set();
    this.snakeGroup.clear();
    this.segMeshes.clear();
    // Store animatable-materials for tier='legendary' pulse
    this._animatedMats = [];
    for (const s of (state.snakes || [])){
      if (!s.alive){
        if (this.prevAliveIds.has(s.id)){
          const head = this.prevHeadPos.get(s.id);
          if (head){
            const col = s.color ? hexToIntSafe(s.color) : 0xff5a6b;
            this.spawnDeathExplosion(head.x, head.z, col);
          }
        }
        continue;
      }
      currentAliveIds.add(s.id);

      // Hent karakter-variant
      const charVariant = getSnakeChar(s.character || 'sn-green');
      const bodyInt = hexToInt(charVariant.body);
      const bellyInt = hexToInt(charVariant.belly);
      const eyeInt = hexToInt(charVariant.eye);
      const accentInt = hexToInt(charVariant.accent);
      const matCfg = getMaterialConfig(charVariant);

      const emissiveInt = typeof matCfg.emissive === 'string' ? hexToInt(matCfg.emissive) : matCfg.emissive;

      // Felles material for kropp
      const makeMat = (isHead) => {
        const m = new THREE.MeshStandardMaterial({
          color: bodyInt,
          roughness: matCfg.roughness,
          metalness: matCfg.metalness,
          emissive: emissiveInt,
          emissiveIntensity: matCfg.emissiveIntensity * (isHead ? 1.2 : 1.0)
        });
        if (matCfg.animated) this._animatedMats.push(m);
        return m;
      };

      const arr = [];
      s.segs.forEach((p, i) => {
        const isHead = i === 0;
        const size = isHead ? 0.95 : 0.82 - Math.min(0.25, i * 0.01);
        const geo = new THREE.BoxGeometry(size, size, size);
        const m = new THREE.Mesh(geo, makeMat(isHead));
        m.position.set(p.x + 0.5, size/2, p.y + 0.5);
        m.castShadow = true;
        this.snakeGroup.add(m);
        arr.push(m);

        // Belly-stripe: liten flat box under hvert segment
        if (!isHead){
          const belly = new THREE.Mesh(
            new THREE.BoxGeometry(size*0.6, 0.1, size*0.9),
            new THREE.MeshStandardMaterial({ color: bellyInt, roughness: 0.7 })
          );
          belly.position.set(p.x + 0.5, 0.06, p.y + 0.5);
          this.snakeGroup.add(belly);
          arr.push(belly);
        }

        if (isHead){
          // Retning basert på s.dir
          const dir = s.dir || 'right';
          const eyeOffsetX = dir === 'left' ? -0.2 : dir === 'right' ? 0.2 : 0;
          const eyeOffsetZ = dir === 'up' ? -0.2 : dir === 'down' ? 0.2 : 0;
          const lateralX = (dir === 'up' || dir === 'down') ? 0.18 : 0;
          const lateralZ = (dir === 'left' || dir === 'right') ? 0.18 : 0;

          // Eyes
          const eyeGeo = new THREE.SphereGeometry(0.11, 10, 8);
          const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
          const pupilGeo = new THREE.SphereGeometry(0.06, 8, 6);
          const pupilMat = new THREE.MeshStandardMaterial({ color: eyeInt, emissive: eyeInt, emissiveIntensity: 0.35 });
          const e1 = new THREE.Mesh(eyeGeo, eyeMat);
          const e2 = new THREE.Mesh(eyeGeo, eyeMat);
          e1.position.set(p.x + 0.5 + eyeOffsetX - lateralX, 0.85, p.y + 0.5 + eyeOffsetZ - lateralZ);
          e2.position.set(p.x + 0.5 + eyeOffsetX + lateralX, 0.85, p.y + 0.5 + eyeOffsetZ + lateralZ);
          this.snakeGroup.add(e1); this.snakeGroup.add(e2);
          const p1 = new THREE.Mesh(pupilGeo, pupilMat);
          const p2 = new THREE.Mesh(pupilGeo, pupilMat);
          const pupilOffset = 0.06;
          const pox = dir === 'left' ? -pupilOffset : dir === 'right' ? pupilOffset : 0;
          const poz = dir === 'up' ? -pupilOffset : dir === 'down' ? pupilOffset : 0;
          p1.position.set(e1.position.x + pox, 0.85, e1.position.z + poz);
          p2.position.set(e2.position.x + pox, 0.85, e2.position.z + poz);
          this.snakeGroup.add(p1); this.snakeGroup.add(p2);
          arr.push(e1, e2, p1, p2);

          // Tunge — kort stripe i retningen slangen går
          const tongueGeo = new THREE.BoxGeometry(0.05, 0.05, 0.32);
          const tongueMat = new THREE.MeshStandardMaterial({ color: 0xE91E63, emissive: 0xE91E63, emissiveIntensity: 0.4 });
          const tongue = new THREE.Mesh(tongueGeo, tongueMat);
          const tonguePos = [p.x + 0.5, 0.62, p.y + 0.5];
          if (dir === 'left'){ tonguePos[0] -= 0.6; tongue.rotation.y = Math.PI/2; }
          else if (dir === 'right'){ tonguePos[0] += 0.6; tongue.rotation.y = Math.PI/2; }
          else if (dir === 'up'){ tonguePos[2] -= 0.6; }
          else if (dir === 'down'){ tonguePos[2] += 0.6; }
          tongue.position.set(...tonguePos);
          this.snakeGroup.add(tongue);
          arr.push(tongue);

          // Tier-badge: liten glow-plate over hodet for legendary/metal/gem
          if (charVariant.tier !== 'classic'){
            const badgeColor = charVariant.tier === 'legendary' ? 0xFFD700
              : charVariant.tier === 'metal' ? 0xFFC107
              : 0x40C4FF;
            const badge = new THREE.Mesh(
              new THREE.TorusGeometry(0.28, 0.04, 6, 16),
              new THREE.MeshBasicMaterial({ color: badgeColor, transparent: true, opacity: 0.75 })
            );
            badge.position.set(p.x + 0.5, 1.15, p.y + 0.5);
            badge.rotation.x = Math.PI/2;
            this.snakeGroup.add(badge);
            arr.push(badge);
          }

          // Trail-ghost
          const prevHead = this.prevHeadPos.get(s.id);
          if (prevHead && (prevHead.x !== p.x || prevHead.z !== p.y)){
            this.spawnTrail(prevHead.x, prevHead.z, bodyInt);
          }
          this.prevHeadPos.set(s.id, { x: p.x, z: p.y });
        }
      });
      this.segMeshes.set(s.id, arr);
    }

    this.prevAliveIds = currentAliveIds;
  }

  spawnFoodSparks(x, y){
    for (let k = 0; k < 8; k++){
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0xffcf4a, transparent: true })
      );
      const ang = Math.random() * Math.PI * 2;
      const spd = 0.08 + Math.random() * 0.12;
      spark.position.set(x + 0.5, 0.5, y + 0.5);
      spark.userData = {
        born: performance.now(), type: 'spark',
        vx: Math.cos(ang) * spd,
        vz: Math.sin(ang) * spd,
        vy: 0.06 + Math.random() * 0.08
      };
      this.fxGroup.add(spark);
    }
  }

  spawnDeathExplosion(x, y, color){
    for (let k = 0; k < 18; k++){
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 6, 4),
        new THREE.MeshBasicMaterial({ color, transparent: true })
      );
      const ang = Math.random() * Math.PI * 2;
      const spd = 0.14 + Math.random() * 0.2;
      spark.position.set(x + 0.5, 0.5, y + 0.5);
      spark.userData = {
        born: performance.now(), type: 'spark',
        vx: Math.cos(ang) * spd,
        vz: Math.sin(ang) * spd,
        vy: 0.12 + Math.random() * 0.1
      };
      this.fxGroup.add(spark);
    }
    const shock = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.3, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    shock.rotation.x = -Math.PI/2;
    shock.position.set(x + 0.5, 0.15, y + 0.5);
    shock.userData = { born: performance.now(), type: 'shock' };
    this.fxGroup.add(shock);
  }

  spawnTrail(x, y, color){
    const ghost = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.85, 0.85),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 })
    );
    ghost.position.set(x + 0.5, 0.42, y + 0.5);
    ghost.userData = { born: performance.now(), type: 'trail' };
    this.trailGroup.add(ghost);
  }

  dispose(){
    this.running = false;
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }

  loop(){
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const t = performance.now();
    // Animate food bob
    this.foodGroup.children.forEach((m, i) => {
      m.position.y = 0.5 + 0.12 * Math.sin(t*0.003 + i);
      m.rotation.y += 0.025;
      const pulse = 1 + 0.06 * Math.sin(t * 0.006 + i);
      m.scale.setScalar(pulse);
    });

    // Trail fade
    for (let i = this.trailGroup.children.length - 1; i >= 0; i--){
      const g = this.trailGroup.children[i];
      const age = (t - g.userData.born) / 1000;
      g.material.opacity = Math.max(0, 0.35 - age * 0.7);
      g.scale.setScalar(1 - age * 0.4);
      if (age > 0.5) this.trailGroup.remove(g);
    }

    // FX-partikler / shockwaves
    for (let i = this.fxGroup.children.length - 1; i >= 0; i--){
      const m = this.fxGroup.children[i];
      const age = (t - m.userData.born) / 1000;
      if (m.userData.type === 'spark'){
        m.position.x += m.userData.vx;
        m.position.z += m.userData.vz;
        m.position.y += m.userData.vy;
        m.userData.vy -= 0.008;
        m.material.opacity = Math.max(0, 1 - age * 1.3);
        if (age > 0.9 || m.position.y < 0) this.fxGroup.remove(m);
      } else if (m.userData.type === 'shock'){
        const r = 0.3 + age * 6;
        m.scale.set(r, r, 1);
        m.material.opacity = Math.max(0, 0.8 - age * 1.4);
        if (age > 0.7) this.fxGroup.remove(m);
      }
    }

    // Animate legendary-tier materials (pulserende emissiv)
    if (this._animatedMats && this._animatedMats.length){
      const pulse = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.004));
      for (const m of this._animatedMats){
        m.emissiveIntensity = pulse;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
