// weapons.js — the armoury. Five guns and two grenades, each a row of numbers
// the combat code reads, plus the first-person view model built from boxes.
// The numbers carry the design: damage falls with range, spread is smallest
// standing still and worst in the air, and the longshot is a scalpel you must
// stop to use — accuracy counts more than speed.
import * as THREE from 'three';
import { PALETTE, material } from './palette.js';

export const WEAPONS = {
  sidearm: {
    label: 'P9 Sidearm', price: 0, damage: 26, headMult: 4, legMult: 0.75,
    rpm: 380, auto: false, mag: 12, reserve: 72, reloadMs: 1100,
    spread: { still: 0.007, move: 0.032, air: 0.09 }, recoil: 0.011,
    range: 55, pellets: 1, moveSpeed: 1.0, zoom: 1,
  },
  smg: {
    label: 'Ratter SMG', price: 1250, damage: 22, headMult: 4, legMult: 0.75,
    rpm: 750, auto: true, mag: 30, reserve: 120, reloadMs: 1900,
    spread: { still: 0.013, move: 0.046, air: 0.1 }, recoil: 0.008,
    range: 42, pellets: 1, moveSpeed: 1.0, zoom: 1,
  },
  scatter: {
    label: 'Derrick Scattergun', price: 1100, damage: 11, headMult: 2.4, legMult: 0.75,
    rpm: 68, auto: false, mag: 6, reserve: 30, reloadMs: 2600,
    spread: { still: 0.045, move: 0.06, air: 0.11 }, recoil: 0.05,
    range: 20, pellets: 8, moveSpeed: 0.97, zoom: 1,
  },
  carbine: {
    label: 'Harbor Carbine', price: 2700, damage: 34, headMult: 4, legMult: 0.75,
    rpm: 600, auto: true, mag: 30, reserve: 120, reloadMs: 2100,
    spread: { still: 0.004, move: 0.034, air: 0.1 }, recoil: 0.013,
    range: 80, pellets: 1, moveSpeed: 0.95, zoom: 1,
  },
  longshot: {
    label: 'Gullwing Longshot', price: 4750, damage: 96, headMult: 2.6, legMult: 0.6,
    rpm: 42, auto: false, mag: 5, reserve: 25, reloadMs: 2900,
    spread: { still: 0.0008, move: 0.11, air: 0.16 }, recoil: 0.055,
    range: 140, pellets: 1, moveSpeed: 0.92, zoom: 3.2,
  },
};

export const GRENADES = {
  frag: { label: 'Frag Grenade', price: 300, fuseMs: 1600, radius: 5.5, damage: 92 },
  flash: { label: 'Flash Charge', price: 200, fuseMs: 1200, radius: 19, damage: 0 },
};

export const ARMOR_PRICE = 650;
export const ARMOR_HELMET_PRICE = 1000;

// A fresh carried weapon: what a fighter holds, as opposed to its table row.
export function makeWeapon(kind) {
  const def = WEAPONS[kind];
  return {
    kind,
    def,
    mag: def.mag,
    reserve: def.reserve,
    reloadingUntil: 0,
    nextShotAt: 0,
    burst: 0, // shots since the trigger was last released: drives recoil climb
  };
}

// Spread in radians for a shot, from how the shooter is moving. `airborne`
// dominates: a jumping shot is a prayer.
export function spreadFor(def, speed, airborne) {
  if (airborne) return def.spread.air;
  const t = Math.min(1, speed / 4.6);
  return def.spread.still + (def.spread.move - def.spread.still) * t;
}

// Damage after range falloff: full inside a third of the range, then a
// straight slide to 55% at the full range and beyond.
export function damageAt(def, dist) {
  const t = Math.max(0, Math.min(1, (dist - def.range / 3) / (def.range * 2 / 3)));
  return def.damage * (1 - 0.45 * t);
}

// --- view models ------------------------------------------------------------
// One group per gun kind, built once and swapped visible. The muzzle marker
// is where flashes and tracers start.

const darkMetal = () => material(PALETTE.steelDark, 0.55, 0.55);
const midMetal = () => material(PALETTE.steel, 0.45, 0.6);

function box(parent, w, h, d, x, y, z, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

export function createViewModel(kind) {
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  if (kind === 'sidearm') {
    box(g, 0.055, 0.09, 0.21, 0, 0, -0.08, darkMetal());
    box(g, 0.05, 0.12, 0.06, 0, -0.09, 0.03, midMetal());
    muzzle.position.set(0, 0.02, -0.2);
  } else if (kind === 'smg') {
    box(g, 0.06, 0.1, 0.34, 0, 0, -0.1, darkMetal());
    box(g, 0.045, 0.045, 0.2, 0, 0.01, -0.34, midMetal());
    box(g, 0.045, 0.16, 0.05, 0, -0.12, -0.02, darkMetal());
    box(g, 0.05, 0.07, 0.12, 0, 0.09, 0.02, midMetal());
    muzzle.position.set(0, 0.01, -0.46);
  } else if (kind === 'scatter') {
    box(g, 0.07, 0.09, 0.5, 0, 0, -0.16, material(PALETTE.wood, 0.8));
    box(g, 0.055, 0.055, 0.34, 0, 0.03, -0.4, darkMetal());
    box(g, 0.06, 0.08, 0.16, 0, -0.05, 0.08, material(PALETTE.wood, 0.8));
    muzzle.position.set(0, 0.03, -0.58);
  } else if (kind === 'longshot') {
    box(g, 0.06, 0.09, 0.62, 0, -0.01, -0.2, material(PALETTE.tealDark, 0.6, 0.2));
    box(g, 0.04, 0.04, 0.42, 0, 0.02, -0.62, darkMetal());
    box(g, 0.05, 0.09, 0.16, 0, 0.1, -0.16, darkMetal()); // scope
    box(g, 0.045, 0.14, 0.05, 0, -0.11, 0.02, darkMetal());
    muzzle.position.set(0, 0.02, -0.84);
  } else {
    // carbine
    box(g, 0.065, 0.11, 0.46, 0, 0, -0.14, darkMetal());
    box(g, 0.05, 0.05, 0.26, 0, 0.02, -0.46, midMetal());
    box(g, 0.05, 0.17, 0.06, 0, -0.13, -0.06, darkMetal());
    box(g, 0.055, 0.06, 0.14, 0, 0.1, -0.05, midMetal()); // carry sight
    box(g, 0.05, 0.09, 0.12, 0, -0.03, 0.14, material(PALETTE.darkCloth, 0.9)); // stock
    muzzle.position.set(0, 0.02, -0.6);
  }
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}
