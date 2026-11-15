// map.js — Portside Nine: a container terminal at dusk. Wardens defend from
// the west, Breachers attack from the east. Site A is the open crane pad in
// the north-west; site B is the cold-store warehouse in the south-east. Three
// lanes join the spawns — north lane, the dock road through mid, and the
// south lane — so every round is a choice about where to be outnumbered.
//
// This module builds the meshes and returns the facts the rest of the game
// runs on: AABB colliders (shared by movement and by bullet ray tests), the
// two sites, the spawns, and a waypoint graph the bots path over.
import * as THREE from 'three';
import { PALETTE, material, emissiveMaterial } from './palette.js';

const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function box(scene, { w, h, d, x, y, z, colour, rough = 0.9, metal = 0, collider = true, top = null, emissive = 0 }) {
  const mesh = new THREE.Mesh(boxGeo, emissive ? emissiveMaterial(colour, emissive) : material(colour, rough, metal));
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (!collider) return mesh;
  return {
    minX: x - w / 2,
    maxX: x + w / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
    top: top ?? y + h / 2,
  };
}

// A shipping container: a coloured box with a darker roof line and door end,
// so a stack of them reads as cargo and not as abstract blocks.
function container(scene, colliders, { x, z, along = 'x', colour, stack = false }) {
  const L = 6.06;
  const W = 2.44;
  const H = 2.6;
  const w = along === 'x' ? L : W;
  const d = along === 'x' ? W : L;
  const c = box(scene, { w, h: H, d, x, y: H / 2, z, colour, rough: 0.75, metal: 0.25 });
  colliders.push(c);
  box(scene, { w: w + 0.06, h: 0.1, d: d + 0.06, x, y: H + 0.05, z, colour: PALETTE.steelDark, collider: false });
  if (stack) {
    box(scene, { w, h: H, d, x, y: H * 1.5, z, colour, rough: 0.75, metal: 0.25, collider: false });
    box(scene, { w: w + 0.06, h: 0.1, d: d + 0.06, x, y: H * 2 + 0.05, z, colour: PALETTE.steelDark, collider: false });
    c.top = H * 2;
  }
  return c;
}

function crate(scene, colliders, { x, z, s = 1.2, colour = PALETTE.wood }) {
  const c = box(scene, { w: s, h: s, d: s, x, y: s / 2, z, colour, rough: 0.95 });
  colliders.push(c);
  return c;
}

export function createMap(scene) {
  const colliders = [];

  // --- light and air -------------------------------------------------------
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 55, 150);
  const hemi = new THREE.HemisphereLight(0x8fa3b8, 0x3a3630, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 1.9);
  sun.position.set(-60, 42, -30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  // --- ground --------------------------------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(104, 76), material(PALETTE.ground, 0.97));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(104, 6.4), material(PALETTE.asphalt, 0.95));
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  road.receiveShadow = true;
  scene.add(road);
  // The sea, south of the quay: a dark plane below the slab's edge.
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(300, 90), material(0x1d3038, 0.35, 0.4));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.5, 84);
  scene.add(sea);
  // Distant port silhouettes so the horizon is not empty sky.
  for (const [x, z, w, h] of [[-70, -60, 26, 17], [-30, -66, 18, 11], [24, -62, 30, 14], [72, -52, 16, 20], [80, 20, 14, 12]]) {
    box(scene, { w, h, d: 10, x, y: h / 2 - 1, z, colour: 0x232b33, collider: false });
  }

  // --- perimeter ------------------------------------------------------------
  colliders.push(box(scene, { w: 106, h: 3, d: 1, x: 0, y: 1.5, z: -37.5, colour: PALETTE.steelDark, rough: 0.8, metal: 0.3 }));
  colliders.push(box(scene, { w: 106, h: 3, d: 1, x: 0, y: 1.5, z: 37.5, colour: PALETTE.steelDark, rough: 0.8, metal: 0.3 }));
  colliders.push(box(scene, { w: 1, h: 3, d: 76, x: -51.5, y: 1.5, z: 0, colour: PALETTE.steelDark, rough: 0.8, metal: 0.3 }));
  colliders.push(box(scene, { w: 1, h: 3, d: 76, x: 51.5, y: 1.5, z: 0, colour: PALETTE.steelDark, rough: 0.8, metal: 0.3 }));

  // --- mid: the dock road choke --------------------------------------------
  container(scene, colliders, { x: -2.15, z: -6, along: 'z', colour: PALETTE.containerBlue, stack: true });
  container(scene, colliders, { x: -2.15, z: 6, along: 'z', colour: PALETTE.containerRed });
  container(scene, colliders, { x: 18, z: -5, along: 'x', colour: PALETTE.containerGreen });
  colliders.push(box(scene, { w: 3, h: 1.1, d: 1, x: 3.5, y: 0.55, z: -11.5, colour: PALETTE.groundDark, rough: 1 })); // low block, crouch cover
  colliders.push(box(scene, { w: 3, h: 1.1, d: 1, x: -10.5, y: 0.55, z: 4.5, colour: PALETTE.groundDark, rough: 1 }));

  // --- north lane ------------------------------------------------------------
  container(scene, colliders, { x: -17, z: -19.8, along: 'x', colour: PALETTE.containerSand });
  container(scene, colliders, { x: 17, z: -21.5, along: 'x', colour: PALETTE.containerRed });
  container(scene, colliders, { x: 31.2, z: -27, along: 'z', colour: PALETTE.containerBlue, stack: true });
  crate(scene, colliders, { x: 8, z: -12 });

  // --- site A: the crane pad --------------------------------------------------
  container(scene, colliders, { x: -35, z: -26.8, along: 'x', colour: PALETTE.containerGreen });
  container(scene, colliders, { x: -22.5, z: -11, along: 'z', colour: PALETTE.containerSand });
  // Gantry crane: two legs, a beam, and a container hanging over the pad.
  colliders.push(box(scene, { w: 1, h: 10, d: 1, x: -36, y: 5, z: -22, colour: PALETTE.rust, rough: 0.7, metal: 0.4 }));
  colliders.push(box(scene, { w: 1, h: 10, d: 1, x: -24, y: 5, z: -22, colour: PALETTE.rust, rough: 0.7, metal: 0.4 }));
  box(scene, { w: 15, h: 1, d: 1.4, x: -30, y: 10.2, z: -22, colour: PALETTE.rust, rough: 0.7, metal: 0.4, collider: false });
  box(scene, { w: 0.12, h: 3.4, d: 0.12, x: -31, y: 8, z: -22, colour: PALETTE.steelDark, collider: false });
  box(scene, { w: 6.06, h: 2.6, d: 2.44, x: -31, y: 4.9, z: -22, colour: PALETTE.containerBlue, rough: 0.75, metal: 0.25, collider: false });

  // --- south lane ---------------------------------------------------------------
  container(scene, colliders, { x: -21, z: 17.2, along: 'x', colour: PALETTE.containerBlue });
  container(scene, colliders, { x: 9, z: 25.2, along: 'x', colour: PALETTE.containerSand, stack: true });
  container(scene, colliders, { x: -4.8, z: 11, along: 'z', colour: PALETTE.containerGreen });
  crate(scene, colliders, { x: -8, z: 24 });
  crate(scene, colliders, { x: 24, z: -8 });

  // --- site B: the cold-store warehouse -----------------------------------------
  const wallH = 4.6;
  const wall = (opts) => colliders.push(box(scene, { ...opts, h: wallH, y: wallH / 2, colour: PALETTE.wall, rough: 0.95 }));
  wall({ w: 16.8, d: 0.4, x: 24.4, z: 9.8 }); // north wall, west of the door
  wall({ w: 8.8, d: 0.4, x: 39.6, z: 9.8 }); // north wall, east of the door
  wall({ w: 28, d: 0.4, x: 30, z: 31.8 }); // south wall
  wall({ w: 0.4, d: 4.8, x: 15.8, z: 12.4 }); // west wall, north of the door
  wall({ w: 0.4, d: 14.8, x: 15.8, z: 24.6 }); // west wall, south of the door
  wall({ w: 0.4, d: 22, x: 44.2, z: 20.8 }); // east wall
  box(scene, { w: 30, h: 0.3, d: 24, x: 30, y: wallH + 0.15, z: 20.8, colour: PALETTE.roof, rough: 0.9, collider: false }); // roof
  colliders.push(box(scene, { w: 4, h: 2.4, d: 3, x: 26, y: 1.2, z: 25.5, colour: PALETTE.glass, rough: 0.4, metal: 0.3 })); // freezer unit
  colliders.push(box(scene, { w: 2.5, h: 2.2, d: 2, x: 41.2, y: 1.1, z: 13, colour: PALETTE.steel, rough: 0.8, metal: 0.3 })); // shelving
  crate(scene, colliders, { x: 37, z: 27 });
  crate(scene, colliders, { x: 21, z: 14 });

  // Lamp posts: an emissive head and a real point light at the two sites and mid.
  for (const [x, z, withLight] of [[-30, -22, true], [30, 21, true], [0, -14, true], [10, 12, false], [-16, -2, false], [36, -8, false]]) {
    box(scene, { w: 0.18, h: 5.4, d: 0.18, x, y: 2.7, z, colour: PALETTE.steelDark, collider: false });
    box(scene, { w: 0.7, h: 0.16, d: 0.4, x, y: 5.45, z, colour: PALETTE.lamp, emissive: 2.2, collider: false });
    if (withLight) {
      const light = new THREE.PointLight(PALETTE.lamp, 60, 30, 1.8);
      light.position.set(x, 5.2, z);
      scene.add(light);
    }
  }
  // Cold-store strip lights inside the warehouse roof.
  for (const x of [22, 30, 38]) {
    box(scene, { w: 3.4, h: 0.1, d: 0.5, x, y: wallH - 0.1, z: 20.8, colour: 0xd9f2f2, emissive: 1.8, collider: false });
  }
  const storeLight = new THREE.PointLight(0xcfe8e8, 50, 26, 1.8);
  storeLight.position.set(30, 4.2, 21);
  scene.add(storeLight);

  // --- painted site rings ------------------------------------------------------
  for (const [x, z] of [[-30, -22], [30, 21]]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(6.2, 7, 40),
      new THREE.MeshBasicMaterial({ color: PALETTE.bombSite, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.02, z);
    scene.add(ring);
  }

  // --- the facts the game runs on ------------------------------------------------
  const sites = [
    { id: 'A', name: 'Crane Pad', x: -30, z: -22, r: 7 },
    { id: 'B', name: 'Cold Store', x: 30, z: 21, r: 7 },
  ];
  const spawns = {
    warden: [[-46, -4], [-46, 0], [-46, 4], [-47.5, -2], [-47.5, 2]],
    breacher: [[46, -4], [46, 0], [46, 4], [47.5, -2], [47.5, 2]],
  };
  // Waypoints: [x, z, isCover]. Bots walk the edges; cover nodes are where a
  // bot may stop and hold an angle.
  const rawNodes = [
    [-44, 0, 0], [-38, -10, 0], [-38, 10, 0], [-34, -16, 0], [-30, -22, 1], [-24, -27, 1],
    [-12, -18, 0], [8, -18, 0], [30, -20, 0], [42, -14, 0], [40, -2, 0], [24, 0, 0],
    [4, 0, 0], [-16, 0, 0], [1.5, -6, 0], [1.5, 6, 0], [12, 14, 0], [17, 16, 0],
    [30, 21, 1], [33.5, 13, 1], [-14, 18, 0], [2, 20, 0], [-38, 22, 0], [40, 8, 0],
    [-20, -18, 0], [-30, -12, 0], [44, 0, 0],
  ];
  const rawEdges = [
    [0, 1], [0, 2], [0, 13], [1, 3], [1, 13], [2, 22], [3, 4], [3, 24], [4, 5],
    [4, 25], [5, 6], [6, 7], [6, 24], [6, 13], [7, 8], [7, 12], [8, 9], [9, 10], [9, 19],
    [10, 11], [10, 26], [11, 12], [11, 16], [11, 23], [12, 13], [12, 14], [12, 15], [12, 16],
    [13, 20], [14, 15], [16, 17], [16, 21], [17, 18], [18, 19], [20, 21],
    [20, 22], [21, 23], [23, 26], [24, 25], [3, 1],
  ];
  const nodes = rawNodes.map(([x, z, cover]) => ({ x, z, cover: cover === 1 }));
  const adjacency = nodes.map(() => []);
  for (const [a, b] of rawEdges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  return { colliders, sites, spawns, nodes, adjacency };
}

// Shortest path over the waypoint graph (breadth-first; the graph is small
// and unweighted). Returns node indices from `from` to `to`, both included,
// or null when no path exists.
export function findPath(map, from, to) {
  if (from === to) return [from];
  const prev = new Array(map.nodes.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length > 0) {
    const at = queue.shift();
    for (const next of map.adjacency[at]) {
      if (prev[next] !== -1) continue;
      prev[next] = at;
      if (next === to) {
        const path = [to];
        let cur = to;
        while (cur !== from) {
          cur = prev[cur];
          path.unshift(cur);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

export function nearestNode(map, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < map.nodes.length; i++) {
    const d = (map.nodes[i].x - x) ** 2 + (map.nodes[i].z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
