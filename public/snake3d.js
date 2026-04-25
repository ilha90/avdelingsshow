// public/snake3d.js — Three.js Snake-scene
// Viktig: dynamisk import av addons via importmap — håndter feil.

import * as THREE from 'three';
import { colorFor } from './avatars.js';

const COLS = 40;
const ROWS = 25;
const CELL = 1;

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

    // Grid tiles (subtle checkerboard)
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
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x5de0ae, emissive: 0x072a1d, roughness: .4 });
    const wb = new THREE.BoxGeometry(COLS + 1, 1.2, 0.6);
    const ws = new THREE.BoxGeometry(0.6, 1.2, ROWS + 1);
    const w1 = new THREE.Mesh(wb, wallMat); w1.position.set(COLS/2, 0.6, -0.3); this.scene.add(w1);
    const w2 = new THREE.Mesh(wb, wallMat); w2.position.set(COLS/2, 0.6, ROWS + 0.3); this.scene.add(w2);
    const w3 = new THREE.Mesh(ws, wallMat); w3.position.set(-0.3, 0.6, ROWS/2); this.scene.add(w3);
    const w4 = new THREE.Mesh(ws, wallMat); w4.position.set(COLS + 0.3, 0.6, ROWS/2); this.scene.add(w4);

    // Groups
    this.snakeGroup = new THREE.Group();
    this.foodGroup = new THREE.Group();
    this.scene.add(this.snakeGroup);
    this.scene.add(this.foodGroup);

    // Internal maps
    this.segMeshes = new Map(); // id -> array of meshes per segment (interpolated)
    this.prevState = null;
    this.curState = null;
    this.interpT = 1;
    this.tickMs = 140;

    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
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
    // state = { snakes: [{id,name,segs:[{x,y}],alive,len}], food: [{x,y}] }
    this.prevState = this.curState;
    this.curState = state;
    this.interpT = 0;
    this.lastTickTime = performance.now();

    // Food
    this.foodGroup.clear();
    const foodGeo = new THREE.SphereGeometry(0.35, 16, 12);
    const foodMat = new THREE.MeshStandardMaterial({ color: 0xffcf4a, emissive: 0xd4af37, emissiveIntensity: 0.6, roughness: 0.3 });
    for (const f of (state.food || [])){
      const m = new THREE.Mesh(foodGeo, foodMat);
      m.position.set(f.x + 0.5, 0.5 + 0.1 * Math.sin(performance.now()*0.002 + f.x + f.y), f.y + 0.5);
      m.castShadow = true;
      this.foodGroup.add(m);
    }

    // Snakes
    this.snakeGroup.clear();
    this.segMeshes.clear();
    for (const s of (state.snakes || [])){
      if (!s.alive) continue;
      const color = s.color || colorFor(s.name || s.id);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.15 });
      const arr = [];
      s.segs.forEach((p, i) => {
        const size = i === 0 ? 0.95 : 0.82;
        const geo = new THREE.BoxGeometry(size, size, size);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(p.x + 0.5, size/2, p.y + 0.5);
        m.castShadow = true;
        this.snakeGroup.add(m);
        arr.push(m);

        if (i === 0){
          // Eyes
          const eyeGeo = new THREE.SphereGeometry(0.1, 8, 6);
          const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
          const e1 = new THREE.Mesh(eyeGeo, eyeMat);
          const e2 = new THREE.Mesh(eyeGeo, eyeMat);
          e1.position.set(p.x + 0.7, 0.8, p.y + 0.35);
          e2.position.set(p.x + 0.7, 0.8, p.y + 0.65);
          this.snakeGroup.add(e1); this.snakeGroup.add(e2);
          arr.push(e1); arr.push(e2);
        }
      });
      this.segMeshes.set(s.id, arr);
    }
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
      m.position.y = 0.5 + 0.1 * Math.sin(t*0.003 + i);
      m.rotation.y += 0.02;
    });
    this.renderer.render(this.scene, this.camera);
  }
}
