// palette.js — PORTFALL's whole look in one place: a working harbour at dusk.
// Sodium lamps and a low sun give the warm side; the sea and the cold-store
// give the cool side. Every material in the game comes from here, so the map
// reads as one chosen palette instead of a box of crayons.
import * as THREE from 'three';

export const PALETTE = {
  sky: 0x1d2733, // dusk blue over the water
  fog: 0x27333f,
  sun: 0xffb36b, // low sun, warm
  lamp: 0xffc37e,
  ground: 0x4a4d4a, // worn concrete
  groundDark: 0x3a3d3a,
  asphalt: 0x33363b, // the dock road
  linePaint: 0xd8c98a, // faded harbour paint
  rust: 0xb0562f, // Breacher rust orange
  rustDark: 0x7e3c20,
  teal: 0x2e8f83, // Warden teal
  tealDark: 0x1d5f57,
  containerRed: 0x9c4038,
  containerBlue: 0x39657e,
  containerGreen: 0x5d7350,
  containerSand: 0xa8895a,
  steel: 0x6b7178,
  steelDark: 0x454a50,
  wall: 0x8a8578, // warehouse blockwork
  wallDark: 0x655f52,
  roof: 0x3c4147,
  wood: 0x8a6b45,
  glass: 0x9fc4c9,
  bombSite: 0xe8b13c, // site paint, harbour yellow
  warden: 0x2ec4b6,
  breacher: 0xe76f51,
  skin: 0xc9a186,
  darkCloth: 0x2c2f33,
  tracer: 0xffd9a0,
  muzzle: 0xffc46b,
};

const cache = new Map();

// One MeshStandardMaterial per (colour, roughness) pair, shared by every mesh
// that wants it: the scene holds a few dozen materials, not a few thousand.
export function material(colour, roughness = 0.9, metalness = 0.0) {
  const key = `${colour}|${roughness}|${metalness}`;
  let mat = cache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color: colour, roughness, metalness });
    cache.set(key, mat);
  }
  return mat;
}

export function emissiveMaterial(colour, intensity = 1.6) {
  const key = `e|${colour}|${intensity}`;
  let mat = cache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: colour,
      emissive: colour,
      emissiveIntensity: intensity,
      roughness: 0.6,
    });
    cache.set(key, mat);
  }
  return mat;
}
