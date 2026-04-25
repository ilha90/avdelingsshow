// public/bomb3d.js — Three.js Bomberman-scene
import * as THREE from 'three';
import { colorFor } from './avatars.js';
import { BOMB_CHARS, getChar, buildCharSvg } from './bomb-chars.js';

const COLS = 25;
const ROWS = 15;
const CELL = 1;

export class BombRenderer {
  constructor(canvas, { follow = false, followId = null } = {}){
    this.canvas = canvas;
    this.follow = follow;
    this.followId = followId;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0a1a15, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a1a15, 30, 80);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
    this.resetOverviewCamera();

    // Lights
    this.scene.add(new THREE.AmbientLight(0xaaccff, 0.35));
    const sun = new THREE.DirectionalLight(0xfff1c0, 1.0);
    sun.position.set(20, 40, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -18; sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -10;
    this.scene.add(sun);
    this.sun = sun;

    // Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(COLS*2, ROWS*2),
      new THREE.MeshStandardMaterial({ color: 0x1c4a39, roughness: 1 })
    );
    ground.rotation.x = -Math.PI/2;
    ground.position.set(COLS/2, 0, ROWS/2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Tile grid floor
    const tileGeo = new THREE.PlaneGeometry(CELL*0.98, CELL*0.98);
    const m1 = new THREE.MeshStandardMaterial({ color: 0x266548, roughness: 1 });
    const m2 = new THREE.MeshStandardMaterial({ color: 0x1f5540, roughness: 1 });
    for (let x=0;x<COLS;x++){
      for (let z=0;z<ROWS;z++){
        const m = new THREE.Mesh(tileGeo, (x+z)%2 ? m1 : m2);
        m.rotation.x = -Math.PI/2;
        m.position.set(x + 0.5, 0.01, z + 0.5);
        this.scene.add(m);
      }
    }

    // Group containers
    this.wallGroup = new THREE.Group();
    this.softGroup = new THREE.Group();
    this.bombGroup = new THREE.Group();
    this.powerGroup = new THREE.Group();
    this.playerGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.scene.add(this.wallGroup, this.softGroup, this.bombGroup, this.powerGroup, this.playerGroup, this.fxGroup);

    // Reusable geometries/materials
    this.hardMat = new THREE.MeshStandardMaterial({ color: 0x556680, roughness: 0.5, metalness: 0.2 });
    this.softMat = new THREE.MeshStandardMaterial({ color: 0xb07a3d, roughness: 0.9 });
    this.hardGeo = new THREE.BoxGeometry(0.98, 1.0, 0.98);
    this.softGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);

    // Interpolation state
    this.playerMeshes = new Map();  // id -> { group, prevX, prevZ, curX, curZ, name, text }
    this.bombMeshes = new Map();
    this.powerMeshes = new Map();
    this.lastTickTime = 0;
    this.tickMs = 220;
    this.lerp = 0.22;

    // Shake
    this.shakeMag = 0; this.shakeUntil = 0;

    // Kill-cam
    this.killCam = null;

    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', () => setTimeout(this.onResize, 120));
    this.onResize();

    this.running = true;
    this.loop = this.loop.bind(this);
    this.loop();
  }

  resetOverviewCamera(){
    this.camera.position.set(COLS/2, 30, ROWS*1.8);
    this.camera.lookAt(COLS/2, 0, ROWS/2);
  }

  setFollow(follow, id){
    this.follow = follow;
    this.followId = id;
    if (!follow) this.resetOverviewCamera();
  }

  onResize(){
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width|0);
    const h = Math.max(1, r.height|0);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w/h;
    this.camera.updateProjectionMatrix();
  }

  setWalls(hardCells, softCells){
    this.wallGroup.clear();
    this.softGroup.clear();
    for (const [x,y] of hardCells){
      const m = new THREE.Mesh(this.hardGeo, this.hardMat);
      m.position.set(x+0.5, 0.5, y+0.5);
      // ikke castShadow på vegger/kasser per perf-mål
      m.receiveShadow = true;
      this.wallGroup.add(m);
    }
    for (const [x,y] of softCells){
      const m = new THREE.Mesh(this.softGeo, this.softMat);
      m.position.set(x+0.5, 0.45, y+0.5);
      m.receiveShadow = true;
      this.softGroup.add(m);
    }
  }

  updateSoft(softCells){
    // Rebuild (soft walls can break)
    this.softGroup.clear();
    for (const [x,y] of softCells){
      const m = new THREE.Mesh(this.softGeo, this.softMat);
      m.position.set(x+0.5, 0.45, y+0.5);
      this.softGroup.add(m);
    }
  }

  // Flammer fra fire-bomber — vis som flammende emoji-sprites
  setFlames(flames){
    if (!this.flameGroup){
      this.flameGroup = new THREE.Group();
      this.scene.add(this.flameGroup);
    }
    // Diff: remove dem som ikke er i nye liste
    const activeKeys = new Set(flames.map(f => f.x + ':' + f.y + ':' + f.until));
    const existing = this.flameGroup.children.slice();
    for (const c of existing){
      if (!activeKeys.has(c.userData.key)){
        this.flameGroup.remove(c);
      }
    }
    const existingKeys = new Set(this.flameGroup.children.map(c => c.userData.key));
    for (const f of flames){
      const key = f.x + ':' + f.y + ':' + f.until;
      if (existingKeys.has(key)) continue;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeEmojiTexture('🔥'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      }));
      sprite.scale.set(0.9, 0.9, 0.9);
      sprite.position.set(f.x + 0.5, 0.5, f.y + 0.5);
      sprite.userData = { key, born: performance.now(), until: f.until };
      this.flameGroup.add(sprite);
      // Ekstra glow-light
      const light = new THREE.PointLight(0xff5a2a, 2, 3, 2);
      light.position.set(f.x + 0.5, 0.6, f.y + 0.5);
      this.fxGroup.add(light);
      light.userData = { born: performance.now(), type: 'flash' };
    }
  }

  setPlayers(players){
    // Create/update player meshes
    const seen = new Set();
    for (const p of players){
      seen.add(p.id);
      let rec = this.playerMeshes.get(p.id);
      if (!rec){
        const group = new THREE.Group();
        const charId = p.character || 'classic';
        const sprite = makeCharacterSprite(charId, { walking: false, facing: 'right', powerups: extractPowerups(p) });
        sprite.scale.set(1.25, 1.55, 1);
        sprite.position.y = 0.78;
        group.add(sprite);
        const base = new THREE.Mesh(
          new THREE.CircleGeometry(0.34, 24),
          new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })
        );
        base.rotation.x = -Math.PI / 2;
        base.position.y = 0.02;
        group.add(base);
        const nameSprite = makeNameTagSprite(p.name, p.color || '#47D197');
        nameSprite.scale.set(1.4, 0.35, 1);
        nameSprite.position.y = 1.7;
        group.add(nameSprite);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.55, 0.05, 8, 32),
          new THREE.MeshBasicMaterial({ color: 0x5de0ae, transparent: true, opacity: 0.85 })
        );
        ring.rotation.x = Math.PI/2;
        ring.position.y = 0.1;
        ring.visible = false;
        group.add(ring);
        rec = {
          group, sprite, base, nameSprite, ring,
          charId, prevX: p.x, prevZ: p.y, curX: p.x, curZ: p.y, dead: false,
          facing: 'right', walking: false, walkPhase: 0, lastWalkToggleAt: 0,
          powerups: extractPowerups(p)
        };
        this.playerGroup.add(group);
        this.playerMeshes.set(p.id, rec);
      } else if (rec.charId !== (p.character || 'classic')){
        // Karakter endret
        rec.group.remove(rec.sprite);
        rec.charId = p.character || 'classic';
        rec.sprite = makeCharacterSprite(rec.charId, { walking: rec.walking, facing: rec.facing, powerups: rec.powerups });
        rec.sprite.scale.set(1.25, 1.55, 1);
        rec.sprite.position.y = 0.78;
        rec.group.add(rec.sprite);
      }

      // Oppdater facing basert på bevegelse
      if (rec.curX !== p.x || rec.curZ !== p.y){
        const dx = p.x - rec.curX;
        const dy = p.y - rec.curZ;
        if (Math.abs(dx) > Math.abs(dy)){
          if (dx > 0) rec.facing = 'right';
          else if (dx < 0) rec.facing = 'left';
        }
      }

      // Oppdater powerups — hvis de endret seg, rebuild sprite
      const newPU = extractPowerups(p);
      if (powerupsDiffer(rec.powerups, newPU)){
        rec.powerups = newPU;
        this._rebuildSprite(rec);
      }

      rec.prevX = rec.curX; rec.prevZ = rec.curZ;
      rec.curX = p.x; rec.curZ = p.y;
      rec.dead = !p.alive;
      rec.group.visible = !!p.alive;
      rec.ring.visible = (p.shield > 0) || (p.invulnerableUntil && Date.now() < p.invulnerableUntil);
    }
    for (const [id, rec] of this.playerMeshes){
      if (!seen.has(id)){
        this.playerGroup.remove(rec.group);
        this.playerMeshes.delete(id);
      }
    }
    this.lastTickTime = performance.now();
  }

  _rebuildSprite(rec){
    rec.group.remove(rec.sprite);
    rec.sprite = makeCharacterSprite(rec.charId, {
      walking: rec.walking, facing: rec.facing, powerups: rec.powerups
    });
    rec.sprite.scale.set(1.25, 1.55, 1);
    rec.sprite.position.y = 0.78;
    rec.group.add(rec.sprite);
  }

  setBombs(bombs){
    const seen = new Set();
    for (const b of bombs){
      seen.add(b.id);
      let rec = this.bombMeshes.get(b.id);
      if (!rec){
        // Velg farge + emoji basert på bombe-type
        let color = 0x111111;
        let emoji = null;
        if (b.type === 'laser'){ color = 0x4080ff; emoji = '⚡'; }
        else if (b.type === 'fire'){ color = 0xff6a2a; emoji = '🌋'; }
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 12), mat);
        mesh.castShadow = true;
        this.bombGroup.add(mesh);
        let emojiSprite = null;
        if (emoji){
          emojiSprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: makeEmojiTexture(emoji),
            transparent: true,
            depthWrite: false
          }));
          emojiSprite.scale.set(0.55, 0.55, 0.55);
          emojiSprite.position.y = 0.55;
          this.bombGroup.add(emojiSprite);
        }
        rec = { mesh, emojiSprite, prevX: b.x, prevZ: b.y, type: b.type };
        this.bombMeshes.set(b.id, rec);
      }
      rec.mesh.position.set(b.x + 0.5, 0.4, b.y + 0.5);
      if (rec.emojiSprite) rec.emojiSprite.position.set(b.x + 0.5, 0.8, b.y + 0.5);
      // Pulse
      const t = performance.now() * 0.007;
      const s = 1 + 0.08 * Math.sin(t + b.x + b.y);
      rec.mesh.scale.setScalar(s);
      rec.mesh.material.emissive = new THREE.Color(b.flashing ? 0xff2a2a : (b.type === 'laser' ? 0x2030a0 : b.type === 'fire' ? 0x802010 : 0x550000));
      rec.mesh.material.emissiveIntensity = b.flashing ? (0.5 + 0.5 * Math.sin(t*4)) : 0.2;
    }
    for (const [id, rec] of this.bombMeshes){
      if (!seen.has(id)){
        this.bombGroup.remove(rec.mesh);
        if (rec.emojiSprite) this.bombGroup.remove(rec.emojiSprite);
        this.bombMeshes.delete(id);
      }
    }
  }

  setPowerups(powerups){
    const seen = new Set();
    for (const p of powerups){
      const id = p.x + ':' + p.y;
      seen.add(id);
      let rec = this.powerMeshes.get(id);
      if (!rec){
        const group = new THREE.Group();
        const emoji = emojiForPower(p.kind);
        // Emoji-sprite som roterer og flyter — ingen bokser!
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: makeEmojiTexture(emoji),
          transparent: true,
          sizeAttenuation: true
        }));
        sprite.scale.set(0.85, 0.85, 0.85);
        sprite.position.y = 0.55;
        group.add(sprite);
        // Liten glow-halo under emoji
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: makeGlowTexture(colorForPower(p.kind)),
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        }));
        glow.scale.set(1.4, 1.4, 1);
        glow.position.y = 0.35;
        group.add(glow);
        group.position.set(p.x + 0.5, 0, p.y + 0.5);
        this.powerGroup.add(group);
        rec = { group, sprite, glow };
        this.powerMeshes.set(id, rec);
      }
      const t = performance.now() * 0.002;
      rec.sprite.position.y = 0.55 + 0.12 * Math.sin(t * 3);
      rec.sprite.material.rotation = Math.sin(t) * 0.15;
      rec.glow.material.opacity = 0.55 + 0.25 * Math.sin(t * 4);
    }
    for (const [id, rec] of this.powerMeshes){
      if (!seen.has(id)){
        this.powerGroup.remove(rec.group);
        this.powerMeshes.delete(id);
      }
    }
  }

  explosion(cells){
    // shockwave ring + particles + directional blast debris
    for (const [x,y] of cells){
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.3, 32),
        new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI/2;
      ring.position.set(x+0.5, 0.3, y+0.5);
      ring.userData = { born: performance.now(), type: 'shockwave' };
      this.fxGroup.add(ring);

      // Andre shockwave-ring (forskjøvet fase)
      const ring2 = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.28, 32),
        new THREE.MeshBasicMaterial({ color: 0xffcf4a, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
      );
      ring2.rotation.x = -Math.PI/2;
      ring2.position.set(x+0.5, 0.31, y+0.5);
      ring2.userData = { born: performance.now() + 120, type: 'shockwave' };
      this.fxGroup.add(ring2);

      const flash = new THREE.PointLight(0xff9a3a, 8, 7, 2);
      flash.position.set(x+0.5, 1.0, y+0.5);
      flash.userData = { born: performance.now(), type: 'flash' };
      this.fxGroup.add(flash);

      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 14, 10),
        new THREE.MeshBasicMaterial({ color: 0xffe38a, transparent: true, opacity: 0.9 })
      );
      sphere.position.set(x+0.5, 0.5, y+0.5);
      sphere.userData = { born: performance.now(), type: 'boom' };
      this.fxGroup.add(sphere);

      // Gnister — 8 små flyvende partikler
      for (let k = 0; k < 6; k++){
        const spark = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 6, 4),
          new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? 0xffcf4a : 0xff6a2a, transparent: true })
        );
        const ang = Math.random() * Math.PI * 2;
        const spd = 0.08 + Math.random() * 0.12;
        spark.position.set(x+0.5, 0.5, y+0.5);
        spark.userData = {
          born: performance.now(), type: 'spark',
          vx: Math.cos(ang) * spd,
          vz: Math.sin(ang) * spd,
          vy: 0.04 + Math.random() * 0.08
        };
        this.fxGroup.add(spark);
      }
    }
    // Sterkere, lengre shake
    this.shakeMag = 0.62;
    this.shakeUntil = performance.now() + 520;
  }

  // Death-animasjon når en spiller blir sprengt: rød kule + "hoppe bakover"
  deathAnim(pid, x, y){
    const rec = this.playerMeshes.get(pid);
    if (!rec) return;
    // Rød glow-sphere på dødsstedet
    const deadSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.85 })
    );
    deadSphere.position.set(x+0.5, 0.5, y+0.5);
    deadSphere.userData = { born: performance.now(), type: 'death' };
    this.fxGroup.add(deadSphere);
    // Ekstra gnistpartikler
    for (let k = 0; k < 14; k++){
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0xff5a6b, transparent: true })
      );
      const ang = Math.random() * Math.PI * 2;
      const spd = 0.12 + Math.random() * 0.18;
      p.position.set(x+0.5, 0.6, y+0.5);
      p.userData = {
        born: performance.now(), type: 'spark',
        vx: Math.cos(ang) * spd,
        vz: Math.sin(ang) * spd,
        vy: 0.1 + Math.random() * 0.1
      };
      this.fxGroup.add(p);
    }
  }

  killCamAt(x, y, ms = 2500){
    this.killCam = { x, y, until: performance.now() + ms };
  }

  dispose(){
    this.running = false;
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }

  loop(){
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(1, (now - this.lastTickTime) / this.tickMs);
    // Interpolate players
    for (const [id, rec] of this.playerMeshes){
      if (rec.dead) continue;
      const x = rec.prevX + (rec.curX - rec.prevX) * Math.min(1, dt);
      const z = rec.prevZ + (rec.curZ - rec.prevZ) * Math.min(1, dt);
      rec.group.position.x += ((x+0.5) - rec.group.position.x) * this.lerp;
      rec.group.position.z += ((z+0.5) - rec.group.position.z) * this.lerp;
      rec.group.position.y = 0;
      if (rec.sprite) rec.sprite.position.y = 0.78 + Math.sin(now*0.006 + rec.curX) * 0.04;

      // Walking-animation: toggle walking-frame hver 160ms mens beveger seg
      const isMoving = rec.curX !== rec.prevX || rec.curZ !== rec.prevZ;
      if (isMoving && (now - rec.lastWalkToggleAt) > 160){
        rec.walking = !rec.walking;
        rec.lastWalkToggleAt = now;
        this._rebuildSprite(rec);
      } else if (!isMoving && rec.walking){
        rec.walking = false;
        rec.lastWalkToggleAt = now;
        this._rebuildSprite(rec);
      }
    }

    // FX lifetime
    for (let i = this.fxGroup.children.length - 1; i >= 0; i--){
      const m = this.fxGroup.children[i];
      const age = (now - m.userData.born) / 1000;
      if (m.userData.type === 'shockwave'){
        const r = 0.3 + age * 6;
        m.scale.set(r, r, 1);
        m.material.opacity = Math.max(0, 0.95 - age * 1.6);
        if (age > 0.8) this.fxGroup.remove(m);
      } else if (m.userData.type === 'boom'){
        const s = 1 + age * 4.5;
        m.scale.setScalar(s);
        m.material.opacity = Math.max(0, 0.9 - age * 2.1);
        if (age > 0.5) this.fxGroup.remove(m);
      } else if (m.userData.type === 'flash'){
        m.intensity = Math.max(0, 8 - age * 22);
        if (age > 0.45) this.fxGroup.remove(m);
      } else if (m.userData.type === 'spark'){
        // Fysikk
        m.position.x += m.userData.vx;
        m.position.z += m.userData.vz;
        m.position.y += m.userData.vy;
        m.userData.vy -= 0.008;
        m.material.opacity = Math.max(0, 1 - age * 1.2);
        if (age > 0.9 || m.position.y < 0) this.fxGroup.remove(m);
      } else if (m.userData.type === 'death'){
        const s = 1 + age * 3;
        m.scale.setScalar(s);
        m.material.opacity = Math.max(0, 0.85 - age * 1.5);
        if (age > 0.6) this.fxGroup.remove(m);
      }
    }

    // Camera
    if (this.killCam && now < this.killCam.until){
      const tx = this.killCam.x + 0.5;
      const tz = this.killCam.y + 0.5;
      this.camera.position.lerp(new THREE.Vector3(tx, 8, tz + 5), 0.08);
      this.camera.lookAt(tx, 0, tz);
    } else if (this.killCam && now >= this.killCam.until){
      this.killCam = null;
      if (!this.follow) this.resetOverviewCamera();
    } else if (this.follow && this.followId){
      const rec = this.playerMeshes.get(this.followId);
      if (rec && !rec.dead){
        const tx = rec.group.position.x;
        const tz = rec.group.position.z;
        this.camera.position.lerp(new THREE.Vector3(tx, 7, tz + 6), 0.1);
        this.camera.lookAt(tx, 0, tz);
      }
    }

    // Shake
    if (now < this.shakeUntil){
      const f = Math.max(0, (this.shakeUntil - now) / 520);
      this.camera.position.x += (Math.random() - 0.5) * this.shakeMag * f;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeMag * f;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeMag * f * 0.4;
    }

    // Flamme-animasjon
    if (this.flameGroup){
      for (const c of this.flameGroup.children.slice()){
        const age = (now - c.userData.born) / 1000;
        const life = (c.userData.until - now) / 1000;
        if (life <= 0){ this.flameGroup.remove(c); continue; }
        // Bob + pulserende
        c.position.y = 0.5 + 0.15 * Math.sin(now * 0.012 + c.position.x);
        c.material.rotation = Math.sin(now * 0.006) * 0.25;
        c.scale.setScalar(0.85 + 0.2 * Math.sin(now * 0.01 + c.position.x));
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}

const _charTexCache = new Map();
function makeCharacterSprite(charId, opts = {}){
  // Nøkkel som tar hensyn til walking-state, facing, powerups
  const pu = opts.powerups || {};
  const puKey = `${!!pu.remote}|${!!pu.fire}|${!!pu.punch}|${pu.speed||0}|${!!pu.shield}|${!!pu.kick}`;
  const key = `${charId}:${opts.walking?1:0}:${opts.facing||'right'}:${puKey}`;
  let tex = _charTexCache.get(key);
  if (!tex){
    const char = getChar(charId);
    const svgStr = buildCharSvg(char, {
      size: 256,
      walking: !!opts.walking,
      facing: opts.facing || 'right',
      powerups: pu
    });
    const img = new Image();
    const dataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
    img.src = dataUri;
    tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    img.onload = () => { tex.needsUpdate = true; };
    _charTexCache.set(key, tex);
  }
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, sizeAttenuation: true
  }));
}

function extractPowerups(p){
  return {
    remote: !!p.remote,
    fire: !!p.fire || !!p.fireBomb,
    punch: !!p.punch,
    speed: p.speed || 0,
    shield: !!(p.shield && p.shield > 0),
    kick: !!p.kick
  };
}
function powerupsDiffer(a, b){
  if (!a || !b) return true;
  return a.remote !== b.remote || a.fire !== b.fire || a.punch !== b.punch ||
         a.speed !== b.speed || a.shield !== b.shield || a.kick !== b.kick;
}

function makeNameTagSprite(name, color){
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 34px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillText(name, 128 + 2, 34 + 2);
  // Hovedtekst
  ctx.fillStyle = color || '#ffffff';
  ctx.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, sizeAttenuation: true
  }));
}

function colorForPower(kind){
  switch(kind){
    case 'bomb': return 0x333333;
    case 'fire': return 0xff6a2a;
    case 'kick': return 0x7a9bff;
    case 'punch': return 0xff5a6b;
    case 'remote': return 0xb074ff;
    case 'shield': return 0x5de0ae;
    case 'gold': return 0xffcf4a;
    case 'speed': return 0xffffff;
    default: return 0xcccccc;
  }
}

function emojiForPower(kind){
  switch(kind){
    case 'bomb': return '💣';
    case 'fire': return '🔥';
    case 'kick': return '👟';
    case 'punch': return '🥊';
    case 'remote': return '📡';
    case 'shield': return '🛡️';
    case 'gold': return '⭐';
    case 'speed': return '⚡';
    default: return '❓';
  }
}

// Texture-cache så vi ikke regenererer samme emoji-canvas hver gang
const _emojiTexCache = new Map();
function makeEmojiTexture(emoji){
  if (_emojiTexCache.has(emoji)) return _emojiTexCache.get(emoji);
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  _emojiTexCache.set(emoji, tex);
  return tex;
}

const _glowTexCache = new Map();
function makeGlowTexture(color){
  const key = color;
  if (_glowTexCache.has(key)) return _glowTexCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const bl = color & 0xff;
  const grad = ctx.createRadialGradient(64, 64, 5, 64, 64, 60);
  grad.addColorStop(0, `rgba(${r},${g},${bl},1)`);
  grad.addColorStop(0.4, `rgba(${r},${g},${bl},0.5)`);
  grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  _glowTexCache.set(key, tex);
  return tex;
}
