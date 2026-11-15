// characters.js — the fighters' bodies: low-poly harbour operators built from
// boxes, in team colours, with a walk cycle in code. One factory makes both
// teams; the difference is cloth colour and a stripe. The same proportions
// drive the hit zones combat uses, so what you see is what you hit:
//
//   head  — a sphere at head height (the expensive place to be shot)
//   body  — the torso box (armour covers this and the head)
//   legs  — everything below the belt (cheaper damage)
import * as THREE from 'three';
import { PALETTE, material } from './palette.js';

export const HEIGHT = 1.78;
export const EYE = 1.62;

const geoCache = new Map();
function geo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    geoCache.set(key, g);
  }
  return g;
}

function part(parent, w, h, d, x, y, z, mat) {
  const mesh = new THREE.Mesh(geo(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

// Builds one fighter. Returns { group, parts, setPose } where setPose drives
// the walk/crouch/death animation from plain numbers the sim owns.
export function createCharacter(team) {
  const isWarden = team === 'warden';
  const cloth = material(isWarden ? PALETTE.teal : PALETTE.rust, 0.92);
  const clothDark = material(isWarden ? PALETTE.tealDark : PALETTE.rustDark, 0.95);
  const dark = material(PALETTE.darkCloth, 0.95);
  const skin = material(PALETTE.skin, 0.8);

  const group = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.86;
  group.add(hips);

  // Legs pivot at the hip: their geometry is translated so each box hangs
  // below its group origin, and rotation.x swings the foot.
  const legGeo = new THREE.BoxGeometry(0.17, 0.86, 0.2);
  legGeo.translate(0, -0.43, 0);
  const legL = new THREE.Mesh(legGeo, dark);
  legL.position.set(-0.11, 0, 0);
  legL.castShadow = true;
  hips.add(legL);
  const legR = new THREE.Mesh(legGeo, dark);
  legR.position.set(0.11, 0, 0);
  legR.castShadow = true;
  hips.add(legR);

  const torso = new THREE.Group();
  torso.position.y = 0.86;
  group.add(torso);
  part(torso, 0.52, 0.62, 0.28, 0, 0.31, 0, cloth); // chest
  part(torso, 0.54, 0.2, 0.3, 0, 0.5, 0, clothDark); // vest top / shoulders
  part(torso, 0.56, 0.1, 0.32, 0, 0.05, 0, dark); // belt line

  const head = new THREE.Group();
  head.position.y = 0.63; // relative to the torso group: centre lands at 1.62
  torso.add(head);
  part(head, 0.24, 0.26, 0.24, 0, 0.13, 0, skin);
  part(head, 0.27, 0.12, 0.27, 0, 0.27, 0, clothDark); // helmet / cap
  part(head, 0.27, 0.05, 0.12, 0, 0.2, -0.12, clothDark); // brim, facing -z

  const armL = new THREE.Group();
  armL.position.set(-0.33, 0.52, 0);
  torso.add(armL);
  part(armL, 0.13, 0.55, 0.15, 0, -0.24, 0, cloth);
  const armR = new THREE.Group();
  armR.position.set(0.33, 0.52, 0);
  torso.add(armR);
  part(armR, 0.13, 0.55, 0.15, 0, -0.24, 0, cloth);

  // The gun: held in the right hand, pointing where the fighter faces (-z).
  const gun = new THREE.Group();
  gun.position.set(0.1, -0.48, -0.12);
  armR.add(gun);
  part(gun, 0.07, 0.12, 0.52, 0, 0, -0.2, material(PALETTE.steelDark, 0.6, 0.5));
  part(gun, 0.05, 0.05, 0.3, 0, 0.03, -0.55, material(PALETTE.steel, 0.5, 0.6));

  let walkPhase = 0;
  let fallT = 1; // 1 = upright; death animates it to 0

  return {
    group,
    team,
    // pose: { speed (m/s), crouch 0..1, aimPitch, dead, dt }
    setPose({ speed = 0, crouch = 0, aimPitch = 0, dead = false, dt = 0 }) {
      walkPhase += dt * (2 + speed * 1.6) * (speed > 0.1 ? 1 : 0);
      const swing = Math.min(1, speed / 3) * 0.55;
      legL.rotation.x = Math.sin(walkPhase) * swing;
      legR.rotation.x = -Math.sin(walkPhase) * swing;
      armL.rotation.x = -Math.sin(walkPhase) * swing * 0.7;
      // The right arm holds the gun up at the aim pitch; the left steadies it.
      armR.rotation.x = -1.25 + aimPitch * 0.7;
      armL.rotation.x = -1.05 + aimPitch * 0.7;
      armL.position.z = -0.18;
      const drop = crouch * 0.42;
      torso.position.y = 0.86 - drop * 0.5;
      head.position.y = 0.63 - drop * 0.5;
      group.position.y = 0;
      if (dead) {
        fallT = Math.max(0, fallT - dt * 2.6);
        group.rotation.x = -(1 - fallT) * (Math.PI / 2) * 0.92;
        group.position.y = (1 - fallT) * 0.12;
      }
    },
  };
}

// Hit zones for a fighter standing at feet position `pos` with the given
// crouch amount, as plain shapes physics.js can ray-test. Head height and
// body top drop as the fighter crouches.
export function hitZones(pos, crouch) {
  const drop = crouch * 0.42;
  return {
    head: { x: pos.x, y: 1.62 - drop, z: pos.z, r: 0.19 },
    body: { minX: pos.x - 0.3, maxX: pos.x + 0.3, minZ: pos.z - 0.2, maxZ: pos.z + 0.2, base: 0.8 - drop * 0.7, top: 1.5 - drop },
    legs: { minX: pos.x - 0.28, maxX: pos.x + 0.28, minZ: pos.z - 0.18, maxZ: pos.z + 0.18, base: 0, top: 0.82 - drop * 0.7 },
  };
}
