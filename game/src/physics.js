// physics.js — the two questions the game asks of the world: "can this body
// move here?" and "what does this ray hit first?". Bodies are upright capsules
// treated as circles on the ground plane; the map's colliders are axis-aligned
// boxes {minX, maxX, minZ, maxZ, top} where top is the box's height (a body
// standing lower than top is blocked; nothing walks on roofs here).
//
// Movement is resolved axis by axis, which gives wall sliding for free and
// never tunnels at the game's speeds and step size.

export function moveBody(body, dx, dz, colliders) {
  // body: {pos: Vector3-like {x,z}, radius}. Mutates body.pos.
  body.pos.x += dx;
  for (const c of colliders) {
    if (body.pos.y !== undefined && body.pos.y >= c.top) continue;
    resolveCircle(body.pos, body.radius, c);
  }
  body.pos.z += dz;
  for (const c of colliders) {
    if (body.pos.y !== undefined && body.pos.y >= c.top) continue;
    resolveCircle(body.pos, body.radius, c);
  }
}

function resolveCircle(pos, radius, c) {
  const nearestX = Math.max(c.minX, Math.min(pos.x, c.maxX));
  const nearestZ = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
  const dx = pos.x - nearestX;
  const dz = pos.z - nearestZ;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    pos.x = nearestX + (dx / d) * radius;
    pos.z = nearestZ + (dz / d) * radius;
    return;
  }
  // Centre inside the box: push out along the shallower penetration axis.
  const pushLeft = pos.x - (c.minX - radius);
  const pushRight = c.maxX + radius - pos.x;
  const pushNear = pos.z - (c.minZ - radius);
  const pushFar = c.maxZ + radius - pos.z;
  const min = Math.min(pushLeft, pushRight, pushNear, pushFar);
  if (min === pushLeft) pos.x = c.minX - radius;
  else if (min === pushRight) pos.x = c.maxX + radius;
  else if (min === pushNear) pos.z = c.minZ - radius;
  else pos.z = c.maxZ + radius;
}

// Ray vs one AABB (slab test). Returns the entry distance or Infinity.
// ro/rd are {x,y,z}; the box is {minX..maxZ, base (bottom y), top}.
export function rayBox(ro, rd, c) {
  const minY = c.base ?? 0;
  const maxY = c.top;
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [ro.x, rd.x, c.minX, c.maxX],
    [ro.y, rd.y, minY, maxY],
    [ro.z, rd.z, c.minZ, c.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// Ray vs a sphere; returns the entry distance or Infinity.
export function raySphere(ro, rd, centre, radius) {
  const ox = ro.x - centre.x;
  const oy = ro.y - centre.y;
  const oz = ro.z - centre.z;
  const b = ox * rd.x + oy * rd.y + oz * rd.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : Infinity;
}

// Line of sight between two points, blocked by any collider box. Used by the
// bots' eyes: cheap enough at a handful of checks per step.
export function hasLineOfSight(a, b, colliders) {
  const rd = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const dist = Math.hypot(rd.x, rd.y, rd.z);
  if (dist < 1e-6) return true;
  rd.x /= dist;
  rd.y /= dist;
  rd.z /= dist;
  for (const c of colliders) {
    const t = rayBox(a, rd, c);
    if (t < dist - 0.05) return false;
  }
  return true;
}
