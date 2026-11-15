// effects.js — the short-lived visuals: tracers, muzzle flashes, impact
// sparks, grenade arcs and the charge itself. Everything is pooled and
// reused; an effect is a few meshes whose life is counted in frames, and the
// update loop walks a fixed-size ring instead of allocating per shot.
import * as THREE from 'three';
import { PALETTE, emissiveMaterial, material } from './palette.js';

const MAX_TRACERS = 48;
const MAX_SPARKS = 40;

export function createEffects(scene) {
  // --- tracers: one stretched additive quad per shot, gone in 60 ms --------
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: PALETTE.tracer, transparent: true, opacity: 0.85 });
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i++) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerAt = 0;

  // --- sparks: a small bright octahedron that pops and shrinks -------------
  const sparkGeo = new THREE.OctahedronGeometry(0.09);
  const sparks = [];
  for (let i = 0; i < MAX_SPARKS; i++) {
    const mesh = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true }));
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, max: 1 });
  }
  let sparkAt = 0;

  // --- one shared muzzle light and flash plane ------------------------------
  const flashLight = new THREE.PointLight(PALETTE.muzzle, 0, 9, 2);
  scene.add(flashLight);
  const flashPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  flashPlane.visible = false;
  scene.add(flashPlane);
  let flashLife = 0;

  // --- explosion / flashbang bloom -------------------------------------------
  const bloom = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xffb36b, transparent: true, opacity: 0 }),
  );
  bloom.visible = false;
  scene.add(bloom);
  const bloomLight = new THREE.PointLight(0xffc37e, 0, 26, 1.6);
  scene.add(bloomLight);
  let bloomT = 1; // 1 = idle
  let bloomKind = 'frag';

  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const mid = new THREE.Vector3();

  return {
    tracer(a, b) {
      const t = tracers[tracerAt];
      tracerAt = (tracerAt + 1) % MAX_TRACERS;
      from.copy(a);
      to.copy(b);
      const len = from.distanceTo(to);
      if (len < 0.5) return;
      mid.addVectors(from, to).multiplyScalar(0.5);
      t.mesh.position.copy(mid);
      t.mesh.scale.set(1, 1, len);
      t.mesh.lookAt(to);
      t.mesh.visible = true;
      t.life = 0.06;
    },
    spark(point, colour = 0xffe2b0, life = 0.16, scale = 1) {
      const s = sparks[sparkAt];
      sparkAt = (sparkAt + 1) % MAX_SPARKS;
      s.mesh.position.copy(point);
      s.mesh.material.color.setHex(colour);
      s.mesh.scale.setScalar(scale);
      s.mesh.visible = true;
      s.life = life;
      s.max = life;
    },
    muzzle(point, cameraDir) {
      flashLight.position.copy(point);
      flashLight.intensity = 26;
      flashPlane.position.copy(point);
      if (cameraDir) flashPlane.lookAt(point.x + cameraDir.x, point.y + cameraDir.y, point.z + cameraDir.z);
      flashPlane.visible = true;
      flashPlane.material.opacity = 0.9;
      flashPlane.rotation.z = Math.random() * Math.PI;
      flashLife = 0.045;
    },
    explode(point, kind) {
      bloom.position.copy(point);
      bloom.material.color.setHex(kind === 'flash' ? 0xffffff : 0xffb36b);
      bloom.visible = true;
      bloomT = 0;
      bloomKind = kind;
      bloomLight.position.copy(point).y += 1;
      bloomLight.intensity = kind === 'flash' ? 60 : 120;
    },
    update(dt) {
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        if (t.life <= 0) t.mesh.visible = false;
      }
      for (const s of sparks) {
        if (s.life <= 0) continue;
        s.life -= dt;
        const k = Math.max(0, s.life / s.max);
        s.mesh.material.opacity = k;
        s.mesh.scale.multiplyScalar(1 - dt * 2.2);
        if (s.life <= 0) s.mesh.visible = false;
      }
      if (flashLife > 0) {
        flashLife -= dt;
        if (flashLife <= 0) {
          flashLight.intensity = 0;
          flashPlane.visible = false;
        }
      }
      if (bloomT < 1) {
        bloomT = Math.min(1, bloomT + dt * (bloomKind === 'flash' ? 1.4 : 2.2));
        const r = bloomKind === 'flash' ? 2.2 : 0.6 + bloomT * 4.6;
        bloom.scale.setScalar(r);
        bloom.material.opacity = 0.75 * (1 - bloomT);
        bloomLight.intensity *= Math.max(0, 1 - dt * 7);
        if (bloomT >= 1) bloom.visible = false;
      }
    },
  };
}

// The breach charge: a slab with a keypad and a light that blinks faster the
// closer it gets to going off. Carried, dropped and planted states all use
// this one mesh; the game moves it.
export function createBomb() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.32), material(PALETTE.steelDark, 0.6, 0.4));
  body.position.y = 0.08;
  body.castShadow = true;
  group.add(body);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.16), emissiveMaterial(0x39d353, 0.9));
  pad.position.set(0, 0.17, 0);
  group.add(pad);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), emissiveMaterial(0xff4444, 2.4));
  lamp.position.set(0.15, 0.18, 0.08);
  group.add(lamp);
  return {
    group, lamp, pad,
    // Blink the warning lamp at the given rate (Hz); 0 = steady on.
    setLamp(hz) {
      lamp.visible = hz <= 0 ? true : (performance.now() / 1000 * hz) % 1 < 0.55;
    },
  };
}
