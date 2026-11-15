// main.js — PORTFALL's one stateful place: the match, the rounds, the money,
// the bomb, and the bullets. The simulation runs on a fixed 60 Hz step; the
// renderer renders whatever the last step left. Every other module is a
// tool this one uses: map.js builds the world, bots.js decides, weapons.js
// numbers the guns, physics.js answers movement and ray questions.
//
// A round: 9 s buy/freeze, then up to 100 s live. The Breachers' carrier
// plants the charge on a site (3 s), it burns for 35 s, a Warden defuses in
// 6 s. Elimination also ends rounds. First team to 7 rounds, at most 12.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap, nearestNode } from './map.js';
import { createCharacter, hitZones } from './characters.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { createBot } from './bots.js';
import { createEffects, createBomb } from './effects.js';
import { createHud, weaponLabel } from './hud.js';
import { WEAPONS, GRENADES, ARMOR_PRICE, ARMOR_HELMET_PRICE, makeWeapon, spreadFor, damageAt } from './weapons.js';
import { rayBox, raySphere, hasLineOfSight, moveBody } from './physics.js';
import * as SFX from './audio.js';

const FIXED = 1 / 60;
const FREEZE_S = 9;
const ROUND_S = 100;
const BOMB_S = 35;
const PLANT_S = 3;
const DEFUSE_S = 6;
const END_S = 4.5;
const WIN_ROUNDS = 7;
const MAX_ROUNDS = 12;
const START_MONEY = 800;

// --- deterministic rng for screenshot mode; live play uses Math.random ----
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const shotSeed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = shot ? mulberry32(shotSeed * 7919) : Math.random;

// Screenshot tooling reads this if anything goes wrong while staging.
window.__shotError = null;
window.addEventListener('error', (e) => {
  if (!window.__shotError) window.__shotError = String(e.message ?? 'error');
});

// --- renderer / scene -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, shot ? 1 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 260);
scene.add(camera);

const map = createMap(scene);
const effects = createEffects(scene);
const bombProp = createBomb();
scene.add(bombProp.group);
const hud = createHud();

// --- fighters ---------------------------------------------------------------
const WARDEN_NAMES = ['MARLOWE', 'IBEN', 'SORIN', 'PETRA'];
const BREACHER_NAMES = ['VEX', 'HOB', 'MIRA', 'TALO', 'RUDA'];

function makeFighter(name, team, isPlayer) {
  return {
    name, team, isPlayer,
    body: { pos: { x: 0, y: 0, z: 0 }, radius: 0.38 },
    vel: { x: 0, z: 0 },
    yaw: team === 'warden' ? -Math.PI / 2 : Math.PI / 2,
    aimYaw: 0, aimTargetPos: null, aimError: 0.03,
    crouchAmt: 0, crouchWanted: false,
    hp: 100, armor: 0, helmet: false, alive: true,
    money: START_MONEY, kills: 0, deaths: 0,
    weapons: { sidearm: makeWeapon('sidearm'), primary: null },
    weaponKind: 'sidearm',
    grenades: { frag: 0, flash: 0 },
    moveVec: { x: 0, z: 0 }, moveSpeed: 0, speedNow: 0,
    triggerHeld: false, channel: null, channelT: 0,
    flashUntil: 0, blindFactor: 0,
    plan: { role: 'holder', site: 'A', holdNode: 4, defuser: false },
    brain: null, char: null, speedSmooth: 0,
  };
}

const fighters = [];
const playerFighter = makeFighter('YOU', 'warden', true);
fighters.push(playerFighter);
WARDEN_NAMES.forEach((n) => fighters.push(makeFighter(n, 'warden', false)));
BREACHER_NAMES.forEach((n) => fighters.push(makeFighter(n, 'breacher', false)));
for (const f of fighters) {
  if (f.isPlayer) continue;
  f.char = createCharacter(f.team);
  scene.add(f.char.group);
  f.brain = createBot(f, map, rng).step;
}
const player = createPlayer(map.colliders);
playerFighter.body = player.state.body; // the player module owns this body
const EMPTY_KEYS = new Set(); // a no-input key set for frozen phases

function currentWeapon(f) {
  return f.weaponKind === 'sidearm' ? f.weapons.sidearm : f.weapons.primary;
}

// --- match state --------------------------------------------------------------
const match = {
  phase: 'menu', // menu | freeze | live | end | matchover
  phaseT: 0,
  round: 0,
  scoreW: 0,
  scoreB: 0,
  time: 0,
  noise: [],
  grenades: [],
  winner: null,
  reason: '',
};
const bomb = { state: 'carried', carrier: null, x: 0, z: 0, site: 'A', timer: 0, beepAt: 0 };
let paused = false;
let started = false;
let zoomed = false;

const botCtx = { fighters, colliders: map.colliders, noise: match.noise, bomb, sites: map.sites, time: 0 };

// --- plans and round setup -----------------------------------------------------
function assignPlans() {
  const breachers = fighters.filter((f) => f.team === 'breacher');
  const wardens = fighters.filter((f) => f.team === 'warden' && !f.isPlayer);
  const site = match.round % 2 === 1 ? (rng() < 0.5 ? 'A' : 'B') : rng() < 0.5 ? 'B' : 'A';
  const planter = breachers[Math.floor(rng() * breachers.length)];
  for (const b of breachers) {
    b.plan.role = b === planter ? 'planter' : 'escort';
    b.plan.site = site;
    b.plan.defuser = false;
  }
  bomb.state = 'carried';
  bomb.carrier = planter;
  bomb.site = site;
  const aHolds = [4, 5];
  const bHolds = [18, 19];
  wardens.forEach((w, i) => {
    w.plan.role = 'holder';
    w.plan.site = i % 2 === 0 ? 'A' : 'B';
    w.plan.holdNode = i % 2 === 0 ? aHolds[i >> 1] : bHolds[i >> 1];
    w.plan.defuser = false;
  });
}

function botBuy(f) {
  const spend = (price) => {
    if (f.money < price) return false;
    f.money -= price;
    return true;
  };
  if (!f.weapons.primary && f.money >= WEAPONS.carbine.price + ARMOR_PRICE && rng() < 0.75) {
    if (spend(WEAPONS.carbine.price)) f.weapons.primary = makeWeapon('carbine');
  } else if (!f.weapons.primary && f.money >= WEAPONS.smg.price && rng() < 0.7) {
    if (spend(WEAPONS.smg.price)) f.weapons.primary = makeWeapon('smg');
  } else if (!f.weapons.primary && f.money >= WEAPONS.scatter.price && rng() < 0.35) {
    if (spend(WEAPONS.scatter.price)) f.weapons.primary = makeWeapon('scatter');
  }
  if (f.armor < 60 && spend(ARMOR_HELMET_PRICE)) {
    f.armor = 100;
    f.helmet = true;
  } else if (f.armor < 30 && spend(ARMOR_PRICE)) {
    f.armor = 100;
  }
  if (f.grenades.frag === 0 && rng() < 0.4 && spend(GRENADES.frag.price)) f.grenades.frag = 1;
  if (f.grenades.flash === 0 && rng() < 0.3 && spend(GRENADES.flash.price)) f.grenades.flash = 1;
  if (f.weapons.primary) f.weaponKind = 'primary';
}

function setupRound() {
  match.round += 1;
  match.phase = 'freeze';
  match.phaseT = FREEZE_S;
  match.grenades.length = 0;
  assignPlans();
  const wSpawns = [...map.spawns.warden];
  const bSpawns = [...map.spawns.breacher];
  for (const f of fighters) {
    const spawn = f.team === 'warden' ? wSpawns.shift() : bSpawns.shift();
    f.alive = true;
    f.hp = 100;
    f.body.pos.x = spawn[0];
    f.body.pos.z = spawn[1];
    f.body.pos.y = 0;
    f.vel.x = 0;
    f.vel.z = 0;
    f.yaw = f.team === 'warden' ? -Math.PI / 2 : Math.PI / 2;
    f.aimYaw = f.yaw;
    f.channel = null;
    f.channelT = 0;
    f.flashUntil = 0;
    f.triggerHeld = false;
    if (!f.isPlayer) botBuy(f);
    // A fighter who died last round goes back to a sidearm and no armour.
    if (f.diedLastRound) {
      f.weapons.primary = null;
      f.weaponKind = 'sidearm';
      f.weapons.sidearm = makeWeapon('sidearm');
      f.armor = 0;
      f.helmet = false;
      f.grenades.frag = 0;
      f.grenades.flash = 0;
      f.diedLastRound = false;
    } else {
      // Survivors keep their kit; magazines are topped up between rounds.
      for (const w of [f.weapons.sidearm, f.weapons.primary]) {
        if (!w) continue;
        w.mag = w.def.mag;
        w.reserve = w.def.reserve;
        w.reloadingUntil = 0;
      }
    }
    if (f.char) {
      f.char.group.visible = true;
      f.char.group.rotation.set(0, 0, 0);
    }
  }
  player.teleport(playerFighter.body.pos.x, playerFighter.body.pos.z, -Math.PI / 2);
  bombProp.group.visible = true;
  hud.setScores(match.scoreW, match.scoreB);
  hud.setPhase(`ROUND ${match.round} — BUY`);
  hud.banner(`ROUND ${match.round}`, `First to ${WIN_ROUNDS} · ${bomb.site === 'A' ? 'Intel: the Breachers favour the Crane Pad' : 'Intel: the Breachers favour the Cold Store'}`, 2400);
  syncBombProp();
  refreshHud();
}

function startMatch() {
  match.scoreW = 0;
  match.scoreB = 0;
  match.round = 0;
  for (const f of fighters) {
    f.money = START_MONEY;
    f.kills = 0;
    f.deaths = 0;
    f.weapons.primary = null;
    f.weaponKind = 'sidearm';
    f.weapons.sidearm = makeWeapon('sidearm');
    f.armor = 0;
    f.helmet = false;
    f.grenades = { frag: 0, flash: 0 };
    f.diedLastRound = false;
  }
  started = true;
  setupRound();
}

// --- combat ---------------------------------------------------------------------
const _dir = { x: 0, y: 0, z: 0 };
const _origin = { x: 0, y: 0, z: 0 };
const _hitPoint = new THREE.Vector3();

function eyeOf(f) {
  const crouchDrop = f.isPlayer ? (1.62 - player.eyeHeight()) : f.crouchAmt * 0.42;
  return { x: f.body.pos.x, y: 1.62 - crouchDrop, z: f.body.pos.z };
}

function fireShot(f, now) {
  const w = currentWeapon(f);
  if (!w || w.mag <= 0) return;
  const def = w.def;
  w.mag -= 1;
  w.nextShotAt = now + 60 / def.rpm;
  w.burst += 1;
  const eye = eyeOf(f);
  _origin.x = eye.x;
  _origin.y = eye.y;
  _origin.z = eye.z;

  // Base aim direction: the player's camera, or a bot's tracked target.
  let basePitch;
  if (f.isPlayer) {
    const yaw = player.viewYaw();
    const pitch = player.viewPitch();
    _dir.x = -Math.sin(yaw) * Math.cos(pitch);
    _dir.y = Math.sin(pitch);
    _dir.z = -Math.cos(yaw) * Math.cos(pitch);
    basePitch = pitch;
  } else {
    const t = f.aimTargetPos ?? { x: f.body.pos.x - Math.sin(f.aimYaw) * 10, y: 1.25, z: f.body.pos.z - Math.cos(f.aimYaw) * 10 };
    _dir.x = t.x - eye.x;
    _dir.y = t.y - eye.y;
    _dir.z = t.z - eye.z;
    const len = Math.hypot(_dir.x, _dir.y, _dir.z) || 1;
    _dir.x /= len;
    _dir.y /= len;
    _dir.z /= len;
    basePitch = Math.asin(_dir.y);
  }

  const spread = spreadFor(def, f.speedNow, f.isPlayer ? player.state.airborne : false) + (f.isPlayer ? 0 : f.aimError);
  const muzzle = muzzleWorld(f, _origin, _dir);
  match.noise.push({ x: f.body.pos.x, z: f.body.pos.z, t: now, team: f.team });
  SFX.sfxShot(w.kind, f.isPlayer ? 0 : Math.min(1, distToPlayer(f) / 55));
  effects.muzzle(muzzle, _dir);

  for (let pellet = 0; pellet < def.pellets; pellet++) {
    const d = jitterDir(_dir, spread);
    const hit = traceRay(f, _origin, d);
    const end = hit
      ? { x: _origin.x + d.x * hit.t, y: _origin.y + d.y * hit.t, z: _origin.z + d.z * hit.t }
      : { x: _origin.x + d.x * 90, y: _origin.y + d.y * 90, z: _origin.z + d.z * 90 };
    _hitPoint.set(end.x, end.y, end.z);
    effects.tracer(muzzle, _hitPoint);
    if (!hit) continue;
    effects.spark(_hitPoint, hit.fighter ? 0xff7a5c : 0xffe2b0, 0.14, hit.fighter ? 1.2 : 0.8);
    if (hit.fighter) applyDamage(f, hit.fighter, def, hit.zone, hit.t, now);
  }

  // Recoil: the player's view kicks; a bot's aim wanders the same way.
  if (f.isPlayer) {
    player.addRecoil(def.recoil * (1 + w.burst * 0.12), (rng() - 0.5) * def.recoil * 0.7);
    viewKick = Math.min(0.03, viewKick + def.recoil * 0.5);
  }
  if (f.isPlayer) refreshAmmoHud();
}

function jitterDir(d, spread) {
  // A random point in the spread cone: two small perpendicular offsets.
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * spread;
  const ox = Math.cos(a) * r;
  const oy = Math.sin(a) * r;
  const out = { x: d.x + ox * 0.9, y: d.y + oy, z: d.z + ox * 0.4 };
  const len = Math.hypot(out.x, out.y, out.z) || 1;
  out.x /= len;
  out.y /= len;
  out.z /= len;
  return out;
}

function muzzleWorld(f, origin, dir) {
  if (f.isPlayer && viewMuzzle) {
    viewMuzzle.getWorldPosition(_hitPoint);
    return _hitPoint;
  }
  return new THREE.Vector3(origin.x + dir.x * 0.55, origin.y - 0.12, origin.z + dir.z * 0.55);
}

function distToPlayer(f) {
  return Math.hypot(f.body.pos.x - playerFighter.body.pos.x, f.body.pos.z - playerFighter.body.pos.z);
}

// The nearest thing a bullet meets: map boxes first as a range cap, then the
// enemy fighters' head, body and legs. Returns {t, fighter, zone} or null.
function traceRay(shooter, ro, rd) {
  let bestT = Infinity;
  for (const c of map.colliders) {
    const t = rayBox(ro, rd, c);
    if (t < bestT) bestT = t;
  }
  let best = null;
  for (const f of fighters) {
    if (!f.alive || f === shooter || f.team === shooter.team) continue;
    const zones = hitZones(f.body.pos, f.isPlayer ? player.state.crouch : f.crouchAmt);
    const th = raySphere(ro, rd, zones.head, zones.head.r);
    if (th < bestT) {
      bestT = th;
      best = { t: th, fighter: f, zone: 'head' };
      continue;
    }
    const tb = rayBox(ro, rd, zones.body);
    if (tb < bestT) {
      bestT = tb;
      best = { t: tb, fighter: f, zone: 'body' };
      continue;
    }
    const tl = rayBox(ro, rd, zones.legs);
    if (tl < bestT) {
      bestT = tl;
      best = { t: tl, fighter: f, zone: 'legs' };
    }
  }
  return best;
}

function applyDamage(shooter, victim, def, zone, dist, now) {
  let dmg = damageAt(def, dist);
  if (zone === 'head') dmg *= def.headMult;
  if (zone === 'legs') dmg *= def.legMult;
  const armoured = zone === 'body' || (zone === 'head' && victim.helmet);
  if (armoured && victim.armor > 0) {
    victim.armor = Math.max(0, victim.armor - dmg * 0.5);
    dmg *= 0.5;
  }
  victim.hp -= dmg;
  if (shooter.isPlayer) {
    hud.hitmarker(victim.hp <= 0);
    SFX.sfxHit(victim.hp <= 0);
  }
  if (victim.isPlayer) {
    hud.damageFlash();
    SFX.sfxHurt();
  }
  if (victim.hp <= 0 && victim.alive) kill(shooter, victim, def, zone === 'head', now);
}

function kill(killer, victim, def, headshot, now) {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths += 1;
  victim.diedLastRound = true;
  victim.triggerHeld = false;
  victim.channel = null;
  killer.kills += 1;
  killer.money += 300;
  const feedLabel = def?.labelOverride ?? weaponLabel(killer.weaponKind === 'primary' ? (killer.weapons.primary?.kind ?? 'sidearm') : 'sidearm');
  hud.killfeed(killer.name, killer.team, victim.name, victim.team, feedLabel, headshot);
  if (bomb.state === 'carried' && bomb.carrier === victim) {
    bomb.state = 'dropped';
    bomb.carrier = null;
    bomb.x = victim.body.pos.x;
    bomb.z = victim.body.pos.z;
    if (!shot) hud.banner('CHARGE DROPPED', '', 1500);
  }
  if (victim.isPlayer && !shot) {
    hud.banner('YOU ARE DOWN', 'Your team fights on without you', 3000);
  }
  checkElimination(now);
}

function teamAlive(team) {
  return fighters.some((f) => f.team === team && f.alive);
}

function checkElimination(now) {
  if (match.phase !== 'live') return;
  const wAlive = teamAlive('warden');
  const bAlive = teamAlive('breacher');
  if (!wAlive) return endRound('breacher', 'Wardens eliminated');
  if (!bAlive && bomb.state !== 'planted') return endRound('warden', 'Breachers eliminated');
  if (!bAlive && bomb.state === 'planted') {
    // The charge is live: the round runs until it fires or is defused.
    return;
  }
}

function endRound(winner, reason) {
  if (match.phase !== 'live') return;
  match.phase = 'end';
  match.phaseT = END_S;
  match.winner = winner;
  match.reason = reason;
  const winPay = 2700;
  const losePay = bomb.state === 'planted' || bomb.state === 'gone' ? 1900 : 1900;
  for (const f of fighters) {
    f.money += f.team === winner ? winPay : losePay;
    f.triggerHeld = false;
    f.channel = null;
  }
  if (winner === 'warden') match.scoreW += 1;
  else match.scoreB += 1;
  hud.setScores(match.scoreW, match.scoreB);
  hud.setBombStatus('');
  hud.banner(winner === 'warden' ? 'WARDENS TAKE THE ROUND' : 'BREACHERS TAKE THE ROUND', reason, 3200);
  SFX.sfxRoundEnd(winner === 'warden');
}

// --- grenades -------------------------------------------------------------------
function throwGrenade(f, kind) {
  if (f.grenades[kind] <= 0 || match.phase !== 'live') return;
  f.grenades[kind] -= 1;
  const eye = eyeOf(f);
  let dx, dy, dz;
  if (f.isPlayer) {
    const yaw = player.viewYaw();
    const pitch = player.viewPitch();
    dx = -Math.sin(yaw) * Math.cos(pitch);
    dy = Math.sin(pitch);
    dz = -Math.cos(yaw) * Math.cos(pitch);
  } else {
    dx = -Math.sin(f.yaw);
    dy = 0;
    dz = -Math.cos(f.yaw);
  }
  match.grenades.push({
    kind,
    owner: f,
    x: eye.x + dx * 0.4, y: eye.y, z: eye.z + dz * 0.4,
    vx: dx * 14, vy: dy * 14 + 3.2, vz: dz * 14,
    fuse: GRENADES[kind].fuse / 1000,
  });
  SFX.sfxThrow();
  if (f.isPlayer) refreshHud();
}

function stepGrenades(dt, now) {
  for (let i = match.grenades.length - 1; i >= 0; i--) {
    const g = match.grenades[i];
    g.fuse -= dt;
    g.vy -= 13 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    if (g.y < 0.09) {
      g.y = 0.09;
      g.vy *= -0.38;
      g.vx *= 0.72;
      g.vz *= 0.72;
      if (Math.abs(g.vy) < 0.6) g.vy = 0;
    }
    for (const c of map.colliders) {
      if (g.y >= (c.top ?? 3)) continue;
      if (g.x > c.minX - 0.09 && g.x < c.maxX + 0.09 && g.z > c.minZ - 0.09 && g.z < c.maxZ + 0.09) {
        const pushL = g.x - (c.minX - 0.09);
        const pushR = (c.maxX + 0.09) - g.x;
        const pushB = g.z - (c.minZ - 0.09);
        const pushF = (c.maxZ + 0.09) - g.z;
        const m = Math.min(pushL, pushR, pushB, pushF);
        if (m === pushL) { g.x = c.minX - 0.09; g.vx = -Math.abs(g.vx) * 0.4; }
        else if (m === pushR) { g.x = c.maxX + 0.09; g.vx = Math.abs(g.vx) * 0.4; }
        else if (m === pushB) { g.z = c.minZ - 0.09; g.vz = -Math.abs(g.vz) * 0.4; }
        else { g.z = c.maxZ + 0.09; g.vz = Math.abs(g.vz) * 0.4; }
      }
    }
    if (g.fuse <= 0) {
      detonate(g, now);
      match.grenades.splice(i, 1);
    }
  }
}

function detonate(g, now) {
  const def = GRENADES[g.kind];
  const at = new THREE.Vector3(g.x, Math.max(0.25, g.y), g.z);
  if (g.kind === 'frag') {
    effects.explode(at, 1);
    SFX.sfxExplosion(Math.min(1, Math.hypot(g.x - playerFighter.body.pos.x, g.z - playerFighter.body.pos.z) / 55));
    for (const f of fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.body.pos.x - g.x, f.body.pos.z - g.z);
      if (d > def.radius) continue;
      const seen = hasLineOfSight(map.colliders, { x: g.x, y: 1.1, z: g.z }, { x: f.body.pos.x, y: 1.15, z: f.body.pos.z });
      const dmg = def.damage * (1 - (d / def.radius) * 0.7) * (seen ? 1 : 0.25);
      damageDirect(g.owner, f, dmg, 'FRAG', now);
    }
  } else {
    effects.flashBang(at);
    SFX.sfxExplosion(0.4);
    for (const f of fighters) {
      if (!f.alive || f === g.owner) continue;
      const d = Math.hypot(f.body.pos.x - g.x, f.body.pos.z - g.z);
      if (d > def.radius) continue;
      const seen = hasLineOfSight(map.colliders, { x: g.x, y: 1.3, z: g.z }, eyeOf(f));
      if (!seen) continue;
      // Looking toward the flash blinds; looking away mostly spares you.
      const fx = -Math.sin(f.isPlayer ? player.viewYaw() : f.yaw);
      const fz = -Math.cos(f.isPlayer ? player.viewYaw() : f.yaw);
      const bx = (g.x - f.body.pos.x) / (d || 1);
      const bz = (g.z - f.body.pos.z) / (d || 1);
      const facing = fx * bx + fz * bz;
      const strength = (1 - d / def.radius) * (facing > -0.15 ? 1 : 0.25);
      if (f.isPlayer) playerFighter.blindFactor = Math.max(playerFighter.blindFactor, Math.min(1, strength + 0.25));
      else f.flashUntil = Math.max(f.flashUntil, now + 1.2 + strength * 3.2);
    }
  }
}

// Damage that does not come from a bullet: grenade blasts.
function damageDirect(shooter, victim, dmg, label, now) {
  if (victim.armor > 0) {
    victim.armor = Math.max(0, victim.armor - dmg * 0.5);
    dmg *= 0.5;
  }
  victim.hp -= dmg;
  if (shooter?.isPlayer) hud.hitmarker(victim.hp <= 0);
  if (victim.isPlayer) {
    hud.damageFlash();
    SFX.sfxHurt();
  }
  if (victim.hp <= 0 && victim.alive) kill(shooter ?? victim, victim, { labelOverride: label }, false, now);
}

// --- bomb channels: planting and defusing ----------------------------------------
function stepChannels(dt, now) {
  for (const f of fighters) {
    if (!f.alive) continue;
    let valid = false;
    if (f.channel === 'plant' && bomb.state === 'carried' && bomb.carrier === f) {
      const s = map.sites[bomb.site === 'B' ? 1 : 0];
      valid = Math.hypot(f.body.pos.x - s.x, f.body.pos.z - s.z) < s.r;
      if (valid && f.channelT >= PLANT_S) {
        bomb.state = 'planted';
        bomb.x = f.body.pos.x;
        bomb.z = f.body.pos.z;
        bomb.timer = BOMB_S;
        bomb.beepAt = now;
        f.money += 300;
        f.channel = null;
        f.channelT = 0;
        hud.banner('CHARGE PLANTED', `${Math.round(BOMB_S)} seconds — Wardens, move`, 2200);
        // The nearest living Warden bot becomes the designated defuser.
        let best = null;
        let bestD = Infinity;
        for (const w of fighters) {
          if (w.team !== 'warden' || w.isPlayer || !w.alive) continue;
          const d = Math.hypot(w.body.pos.x - bomb.x, w.body.pos.z - bomb.z);
          if (d < bestD) { bestD = d; best = w; }
        }
        if (best) best.plan.defuser = true;
      }
    } else if (f.channel === 'defuse' && bomb.state === 'planted') {
      valid = Math.hypot(f.body.pos.x - bomb.x, f.body.pos.z - bomb.z) < 2.3;
      if (valid && f.channelT >= DEFUSE_S) {
        bomb.state = 'gone';
        f.money += 300;
        f.channel = null;
        f.channelT = 0;
        hud.channel('', null);
        endRound('warden', 'Charge defused');
        return;
      }
    }
    if (f.channel) {
      if (valid) f.channelT += dt;
      else { f.channel = null; f.channelT = 0; }
    }
  }
  // The player's own defuse progress bar.
  if (playerFighter.channel === 'defuse' && bomb.state === 'planted') {
    hud.channel('DEFUSING', Math.min(1, playerFighter.channelT / DEFUSE_S));
  } else if (!shot) {
    hud.channel('', null);
  }
  // Picking up a dropped charge.
  if (bomb.state === 'dropped') {
    for (const f of fighters) {
      if (!f.alive || f.team !== 'breacher') continue;
      if (Math.hypot(f.body.pos.x - bomb.x, f.body.pos.z - bomb.z) < 1.2) {
        bomb.state = 'carried';
        bomb.carrier = f;
        f.plan.role = 'planter';
        const na = Math.hypot(f.body.pos.x - map.sites[0].x, f.body.pos.z - map.sites[0].z);
        const nb = Math.hypot(f.body.pos.x - map.sites[1].x, f.body.pos.z - map.sites[1].z);
        f.plan.site = na < nb ? 'A' : 'B';
        bomb.site = f.plan.site;
        break;
      }
    }
  }
}

// --- reloads and firing driver ------------------------------------------------------
function startReload(f, now) {
  const w = currentWeapon(f);
  if (!w || w.reloading || w.mag >= w.def.mag || w.reserve <= 0) return;
  w.reloading = true;
  w.reloadingUntil = now + w.def.reloadMs / 1000;
  if (f.isPlayer) SFX.sfxReload();
}

function stepWeapons(dt, now) {
  for (const f of fighters) {
    if (!f.alive) continue;
    const w = currentWeapon(f);
    if (!w) continue;
    if (w.reloading && now >= w.reloadingUntil) {
      const take = Math.min(w.def.mag - w.mag, w.reserve);
      w.mag += take;
      w.reserve -= take;
      w.reloading = false;
      if (f.isPlayer) refreshAmmoHud();
    }
    if (!f.triggerHeld) w.burst = 0;
    if (match.phase !== 'live') continue;
    if (f.triggerHeld && !w.reloading && now >= w.nextShotAt) {
      if (w.mag > 0) fireShot(f, now);
      else {
        if (f.isPlayer && !shot) SFX.sfxDryFire();
        startReload(f, now);
      }
    }
    if (!f.isPlayer && w.mag === 0 && !w.reloading) startReload(f, now);
  }
}

// --- the fixed step -------------------------------------------------------------------
function step(dt) {
  const now = match.time + dt;
  match.time = now;
  botCtx.time = now;
  while (match.noise.length && now - match.noise[0].t > 1.2) match.noise.shift();

  if (match.phase === 'freeze') {
    match.phaseT -= dt;
    player.step(dt, EMPTY_KEYS);
    if (match.phaseT <= 0) {
      match.phase = 'live';
      match.phaseT = ROUND_S;
      buyOpen = false;
      hud.setPhase('LIVE');
      hud.banner('ROUND LIVE', bomb.site === 'A' ? 'Defend the Crane Pad' : 'Defend the Cold Store', 1400);
    }
  } else if (match.phase === 'live') {
    if (bomb.state !== 'planted') match.phaseT -= dt;
    // Brains decide; the shared executor below moves and fires everyone.
    for (const f of fighters) {
      if (!f.alive || f.isPlayer) continue;
      f.brain(dt, now, botCtx);
    }
    stepBots(dt);
    stepPlayer(dt);
    stepChannels(dt, now);
    if (bomb.state === 'planted') {
      bomb.timer -= dt;
      const interval = bomb.timer > 10 ? 1 : bomb.timer > 5 ? 0.5 : 0.25;
      if (now >= bomb.beepAt) {
        bomb.beepAt = now + interval;
        SFX.sfxBeep(Math.min(1, distToPlayer({ body: { pos: { x: bomb.x, z: bomb.z } } }) / 50));
      }
      if (bomb.timer <= 0) {
        bomb.state = 'gone';
        effects.explode(new THREE.Vector3(bomb.x, 0.4, bomb.z), 3.2);
        SFX.sfxExplosion(0);
        endRound('breacher', 'Charge detonated');
      }
    } else if (match.phaseT <= 0 && match.phase === 'live') {
      endRound('warden', 'Time — the port holds');
    }
  } else if (match.phase === 'end') {
    match.phaseT -= dt;
    if (match.phaseT <= 0) {
      if (match.scoreW >= WIN_ROUNDS || match.scoreB >= WIN_ROUNDS || match.round >= MAX_ROUNDS) {
        match.phase = 'matchover';
        const won = match.scoreW > match.scoreB;
        const drawn = match.scoreW === match.scoreB;
        hud.showOverlay(
          drawn ? 'HARBOUR DRAWN' : won ? 'WARDENS HOLD THE PORT' : 'THE PORT FALLS',
          `<p>Final score — Wardens ${match.scoreW} · Breachers ${match.scoreB}. ${drawn ? 'Neither crew takes Portside Nine tonight.' : won ? 'The manifest is safe and the cranes stand down.' : 'The cold store is breached. The night crew owns the harbour now.'}</p>`,
          'Play again',
        );
        document.exitPointerLock?.();
      } else {
        setupRound();
      }
    }
  }
  stepWeapons(dt, now);
  if (match.phase === 'live') stepGrenades(dt, now);
  syncPlayerFighter();
}

function stepBots(dt) {
  for (const f of fighters) {
    if (f.isPlayer || !f.alive) continue;
    // Ease yaw toward the brain's desired heading.
    let dy = f.aimYaw - f.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const maxTurn = 3.6 * dt;
    f.yaw += Math.max(-maxTurn, Math.min(maxTurn, dy));
    // Accelerate toward the brain's desired velocity, then slide along walls.
    const wantX = f.moveVec.x * f.moveSpeed;
    const wantZ = f.moveVec.z * f.moveSpeed;
    const accel = 26 * dt;
    f.vel.x += Math.max(-accel, Math.min(accel, wantX - f.vel.x));
    f.vel.z += Math.max(-accel, Math.min(accel, wantZ - f.vel.z));
    const beforeX = f.body.pos.x;
    const beforeZ = f.body.pos.z;
    moveBody(f.body, f.vel.x * dt, f.vel.z * dt, map.colliders);
    f.speedNow = Math.hypot(f.body.pos.x - beforeX, f.body.pos.z - beforeZ) / Math.max(dt, 1e-5);
    f.crouchAmt += ((f.crouchWanted ? 1 : 0) - f.crouchAmt) * Math.min(1, 7 * dt);
  }
}

function stepPlayer(dt) {
  const p = playerFighter;
  if (!p.alive) {
    p.triggerHeld = false;
    return;
  }
  const look = input.takeLook();
  if (look.dx || look.dy) {
    const sens = zoomed ? 0.4 : 1;
    player.look(look.dx * sens, look.dy * sens);
  }
  const k = input.keys;
  player.step(dt, shot ? EMPTY_KEYS : k);
  // Trigger: automatic weapons fire held; semi-automatics need a fresh press.
  const w = currentWeapon(p);
  if (shot) {
    p.triggerHeld = shotTrigger;
  } else if (input.firing && input.locked) {
    p.triggerHeld = w && w.def.auto ? true : !prevFiring;
  } else {
    p.triggerHeld = false;
  }
  prevFiring = input.firing;
  // Defusing is a held key near the planted charge.
  p.channel = k.has('KeyE') && bomb.state === 'planted' ? 'defuse' : null;
  if (!p.channel) p.channelT = Math.min(p.channelT, 0);
  // Reload and weapon swaps.
  if (input.wasPressed('KeyR')) startReload(p, match.time);
  if (!buyOpen) {
    if (input.wasPressed('Digit1')) selectWeapon('sidearm');
    if (input.wasPressed('Digit2') && p.weapons.primary) selectWeapon('primary');
    if (input.wasPressed('Digit3')) throwGrenade(p, 'frag');
    if (input.wasPressed('Digit4')) throwGrenade(p, 'flash');
  }
}

function syncPlayerFighter() {
  const p = playerFighter;
  p.speedNow = player.state.speed;
  p.crouchAmt = player.state.crouch;
}

function selectWeapon(kind) {
  if (playerFighter.weaponKind === kind) return;
  playerFighter.weaponKind = kind;
  setViewModel(kind === 'primary' ? playerFighter.weapons.primary.kind : 'sidearm');
  refreshHud();
}

// --- HUD plumbing -------------------------------------------------------------------
let buyOpen = false;
let prevFiring = false;
let shotTrigger = false;
let viewKick = 0;
let viewModel = null;
let viewMuzzle = null;
let currentFov = 74;

function refreshAmmoHud() {
  const w = currentWeapon(playerFighter);
  if (w) hud.setAmmo(w.mag, w.reserve, w.reloading);
}

function refreshHud() {
  const p = playerFighter;
  hud.setHealth(p.hp);
  hud.setArmor(p.armor);
  hud.setMoney(p.money);
  hud.setGrenades(p.grenades.frag, p.grenades.flash);
  hud.setWeapon(weaponLabel(p.weaponKind === 'primary' ? (p.weapons.primary?.kind ?? 'sidearm') : 'sidearm').toUpperCase());
  refreshAmmoHud();
}

const BUY_ITEMS = [
  { key: 'carbine', label: 'Harbor Carbine', note: 'auto rifle', price: () => WEAPONS.carbine.price },
  { key: 'smg', label: 'Ratter SMG', note: 'fast, close', price: () => WEAPONS.smg.price },
  { key: 'scatter', label: 'Derrick Scattergun', note: '8 pellets', price: () => WEAPONS.scatter.price },
  { key: 'longshot', label: 'Gullwing Longshot', note: 'scoped, one-shot head', price: () => WEAPONS.longshot.price },
  { key: 'armor', label: 'Kevlar Vest', note: 'halves body damage', price: () => ARMOR_PRICE },
  { key: 'helmet', label: 'Vest + Helmet', note: 'head protection too', price: () => ARMOR_HELMET_PRICE },
  { key: 'frag', label: 'Frag Grenade', note: 'key 3 to throw', price: () => GRENADES.frag.price },
  { key: 'flash', label: 'Flash Charge', note: 'key 4 to throw', price: () => GRENADES.flash.price },
  { key: 'ammo', label: 'Ammunition', note: 'refill both weapons', price: () => 150 },
];

function buyItem(idx) {
  const p = playerFighter;
  const item = BUY_ITEMS[idx];
  if (!item) return;
  const price = item.price();
  if (p.money < price) return;
  const buyPrimary = (kind) => {
    p.weapons.primary = makeWeapon(kind);
    p.money -= price;
    selectWeapon('primary');
  };
  switch (item.key) {
    case 'carbine': case 'smg': case 'scatter': case 'longshot':
      if (p.weapons.primary?.kind === item.key) return;
      buyPrimary(item.key);
      break;
    case 'armor':
      if (p.armor >= 100) return;
      p.armor = 100;
      p.money -= price;
      break;
    case 'helmet':
      if (p.helmet && p.armor >= 100) return;
      p.armor = 100;
      p.helmet = true;
      p.money -= price;
      break;
    case 'frag':
      if (p.grenades.frag >= 2) return;
      p.grenades.frag += 1;
      p.money -= price;
      break;
    case 'flash':
      if (p.grenades.flash >= 2) return;
      p.grenades.flash += 1;
      p.money -= price;
      break;
    case 'ammo': {
      let needed = false;
      for (const w of [p.weapons.sidearm, p.weapons.primary]) {
        if (w && w.reserve < w.def.reserve) needed = true;
      }
      if (!needed) return;
      for (const w of [p.weapons.sidearm, p.weapons.primary]) if (w) w.reserve = w.def.reserve;
      p.money -= price;
      break;
    }
  }
  refreshHud();
  renderBuyMenu();
}

function renderBuyMenu() {
  const p = playerFighter;
  const items = BUY_ITEMS.map((item) => {
    const price = item.price();
    let owned = false;
    if (['carbine', 'smg', 'scatter', 'longshot'].includes(item.key)) owned = p.weapons.primary?.kind === item.key;
    if (item.key === 'armor') owned = p.armor >= 100;
    if (item.key === 'helmet') owned = p.helmet && p.armor >= 100;
    if (item.key === 'frag') owned = p.grenades.frag >= 2;
    if (item.key === 'flash') owned = p.grenades.flash >= 2;
    if (item.key === 'ammo') owned = [p.weapons.sidearm, p.weapons.primary].every((w) => !w || w.reserve >= w.def.reserve);
    return { label: item.label, note: item.note, price, owned, canBuy: !owned && p.money >= price };
  });
  hud.renderBuy(p.money, items, buyOpen);
}

// --- view model ----------------------------------------------------------------------
import { createViewModel } from './weapons.js';
function setViewModel(kind) {
  if (viewModel) {
    camera.remove(viewModel);
    viewModel = null;
    viewMuzzle = null;
  }
  viewModel = createViewModel(kind);
  viewModel.position.set(0.24, -0.22, -0.45);
  camera.add(viewModel);
  viewMuzzle = viewModel.userData.muzzle;
}

// --- input wiring ----------------------------------------------------------------------
const input = createInput(renderer.domElement, (locked) => {
  if (!locked && started && !shot && (match.phase === 'live' || match.phase === 'freeze')) {
    paused = true;
    hud.showOverlay('PAUSED', '<p>The match is waiting on you.</p>', 'Click to resume');
  }
});

hud.onPlay(() => {
  SFX.ensureAudio();
  if (match.phase === 'matchover') {
    hud.hideOverlay();
    startMatch();
    input.requestLock();
    return;
  }
  if (!started) {
    hud.hideOverlay();
    startMatch();
    setViewModel('sidearm');
    input.requestLock();
    return;
  }
  paused = false;
  hud.hideOverlay();
  input.requestLock();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (shot) return;
  if (e.code === 'KeyB' && match.phase === 'freeze' && playerFighter.alive && !paused) {
    buyOpen = !buyOpen;
    renderBuyMenu();
  }
  if (buyOpen && /^Digit[1-9]$/.test(e.code)) {
    buyItem(Number(e.code.slice(5)) - 1);
  }
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 2) zoomed = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 2) zoomed = false;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- per-frame visuals ------------------------------------------------------------------
const _v = new THREE.Vector3();
function syncVisuals(dt) {
  const now = match.time;
  // Bot figures follow their simulation bodies.
  for (const f of fighters) {
    if (f.isPlayer || !f.char) continue;
    f.char.group.position.set(f.body.pos.x, 0, f.body.pos.z);
    f.char.group.rotation.y = f.yaw;
    f.speedSmooth += ((f.alive ? f.speedNow : 0) - f.speedSmooth) * Math.min(1, 10 * dt);
    let aimPitch = 0;
    if (f.aimTargetPos) {
      const dx = f.aimTargetPos.x - f.body.pos.x;
      const dz = f.aimTargetPos.z - f.body.pos.z;
      aimPitch = Math.atan2(f.aimTargetPos.y - 1.45, Math.hypot(dx, dz));
    }
    f.char.setPose({ speed: f.speedSmooth, crouch: f.crouchAmt, aimPitch, dead: !f.alive, dt });
  }
  // The bomb prop rides its carrier, rests where dropped, ticks when planted.
  syncBombProp(now);
  // Grenade props are simple dark spheres.
  syncGrenadeProps();

  if (shot === 'menu') {
    const a = 2.35;
    camera.position.set(Math.cos(a) * 30, 12.5, Math.sin(a) * 30 - 2);
    camera.lookAt(0, 0.5, -2);
    return;
  }

  // Camera from the player's body.
  const p = playerFighter;
  const eyeY = p.alive ? player.eyeHeight() : 0.45;
  camera.position.set(p.body.pos.x, (p.body.pos.y ?? 0) + eyeY, p.body.pos.z);
  viewKick *= Math.pow(0.0001, dt);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(player.viewPitch() + viewKick, player.viewYaw(), 0);
  // Zoom on the longshot.
  const w = currentWeapon(p);
  const wantZoom = zoomed && p.alive && w && w.def.zoom > 1 && match.phase === 'live';
  const targetFov = wantZoom ? 74 / w.def.zoom : 74;
  if (Math.abs(targetFov - currentFov) > 0.05) {
    currentFov += (targetFov - currentFov) * Math.min(1, 14 * dt);
    camera.fov = currentFov;
    camera.updateProjectionMatrix();
    hud.setScope(currentFov < 40);
  }
  // View model: bob with movement, dip while reloading, hide when down.
  if (viewModel) {
    viewModel.visible = p.alive;
    const sp = Math.min(1, player.state.speed / 5);
    const bobT = now * 9;
    viewModel.position.y = -0.22 + Math.sin(bobT) * 0.008 * sp;
    viewModel.position.x = 0.24 + Math.cos(bobT * 0.5) * 0.004 * sp;
    if (w && w.reloading) {
      const prog = 1 - Math.max(0, w.reloadingUntil - now) / (w.def.reloadMs / 1000);
      viewModel.rotation.x = -0.85 * Math.sin(Math.min(1, prog) * Math.PI);
    } else {
      viewModel.rotation.x = 0;
    }
  }
  // Flash blindness decays.
  if (p.blindFactor > 0) {
    p.blindFactor = Math.max(0, p.blindFactor - dt * 0.35);
  }
  hud.setFlash(p.blindFactor);
  // Crosshair bloom follows the live spread of the held weapon.
  if (w) {
    const spread = spreadFor(w.def, p.speedNow, player.state.airborne);
    const px = (Math.tan(spread) * (window.innerHeight / 2)) / Math.tan((currentFov * Math.PI) / 360);
    hud.setCrosshairSpread(4 + px);
  }
  // Clock and phase readouts.
  if (match.phase === 'freeze') {
    hud.setTimer(`0:${String(Math.ceil(match.phaseT)).padStart(2, '0')}`, false);
    hud.setPhase(`ROUND ${match.round} — BUY · B FOR SUPPLY`);
  } else if (match.phase === 'live') {
    if (bomb.state === 'planted') {
      const t = Math.max(0, bomb.timer);
      hud.setTimer(`0:${String(Math.ceil(t)).padStart(2, '0')}`, t < 10);
      hud.setPhase('CHARGE PLANTED');
      hud.setBombStatus(`⚠ CHARGE PLANTED AT ${bomb.site === 'A' ? 'CRANE PAD' : 'COLD STORE'} — ${Math.ceil(t)}s`);
    } else {
      const t = Math.max(0, match.phaseT);
      hud.setTimer(`${Math.floor(t / 60)}:${String(Math.ceil(t % 60)).padStart(2, '0')}`, t < 10);
      hud.setPhase(`ROUND ${match.round} — LIVE`);
      hud.setBombStatus(bomb.state === 'dropped' ? 'CHARGE DROPPED' : '');
    }
  }
  hud.setHealth(p.hp);
  hud.setArmor(p.armor);
  hud.setMoney(p.money);
  // Scoreboard while Tab is held.
  if (input.keys.has('Tab')) {
    const rows = [...fighters]
      .sort((a, b) => b.kills - a.kills)
      .map((f) => ({ name: f.name, team: f.team, kills: f.kills, deaths: f.deaths, money: f.money }));
    hud.scoreboard(rows);
  } else {
    hud.scoreboard(null);
  }
}

function syncBombProp(now) {
  const g = bombProp.group;
  if (bomb.state === 'carried' && bomb.carrier) {
    const c = bomb.carrier;
    g.visible = !c.isPlayer;
    g.position.set(c.body.pos.x + Math.sin(c.yaw) * 0.3, 0.62, c.body.pos.z + Math.cos(c.yaw) * 0.3);
    bombProp.setLamp(0.5);
  } else if (bomb.state === 'dropped') {
    g.visible = true;
    g.position.set(bomb.x, 0.1, bomb.z);
    bombProp.setLamp(0.5);
  } else if (bomb.state === 'planted') {
    g.visible = true;
    g.position.set(bomb.x, 0.1, bomb.z);
    bombProp.setLamp(bomb.timer > 10 ? 1.4 : bomb.timer > 5 ? 3 : 6);
  } else {
    g.visible = false;
  }
}

const grenadeProps = new Map();
const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
function syncGrenadeProps() {
  const live = new Set();
  for (const g of match.grenades) {
    live.add(g);
    let mesh = grenadeProps.get(g);
    if (!mesh) {
      mesh = new THREE.Mesh(grenadeGeo, new THREE.MeshStandardMaterial({ color: g.kind === 'frag' ? 0x3a4148 : 0xd8d3c3, roughness: 0.6 }));
      scene.add(mesh);
      grenadeProps.set(g, mesh);
    }
    mesh.position.set(g.x, g.y, g.z);
  }
  for (const [g, mesh] of grenadeProps) {
    if (!live.has(g)) {
      scene.remove(mesh);
      grenadeProps.delete(g);
    }
  }
}

// --- boot placement (menu backdrop) ------------------------------------------------------
function placeAtSpawns() {
  const wSpawns = [...map.spawns.warden];
  const bSpawns = [...map.spawns.breacher];
  for (const f of fighters) {
    const s = f.team === 'warden' ? wSpawns.shift() : bSpawns.shift();
    f.body.pos.x = s[0];
    f.body.pos.z = s[1];
    if (f.isPlayer) player.teleport(s[0], s[1], -Math.PI / 2);
  }
  bomb.state = 'carried';
  bomb.carrier = fighters.find((f) => f.team === 'breacher');
  syncBombProp(0);
}
placeAtSpawns();
refreshHud();
if (!shot) hud.els.overlay.style.display = 'grid';

// --- screenshot staging -------------------------------------------------------------------
// The three captures are the real game, staged: the menu orbit, a live fire-
// fight on the north lane, and a plant at the Cold Store with the player
// covering the door. Each runs the actual simulation, then freezes it.
let shotStage = null;
if (shot === 'yard' || shot === 'plant') {
  hud.hideOverlay();
  document.getElementById('hud').style.display = 'block';
  startMatch();
  match.phase = 'live';
  match.phaseT = 90;
  hud.setPhase('LIVE');
  if (shot === 'yard') {
    for (const f of fighters) if (f.team === 'breacher') f.plan.site = 'A';
    const spots = [[26, -19], [20, -20.5], [32, -17], [16, -18], [38, -20]];
    fighters.filter((f) => f.team === 'breacher').forEach((f, i) => {
      f.body.pos.x = spots[i][0];
      f.body.pos.z = spots[i][1];
    });
    // The Warden bots meet the push in the lane, in front of the player:
    // they draw the first fire and make the frame a team fight, not a duel.
    const wSpots = [[-6, -16], [-4, -20.5], [0, -14], [-8, -22]];
    fighters.filter((f) => f.team === 'warden' && !f.isPlayer).forEach((f, i) => {
      f.body.pos.x = wSpots[i][0];
      f.body.pos.z = wSpots[i][1];
    });
    playerFighter.weapons.primary = makeWeapon('carbine');
    playerFighter.weaponKind = 'primary';
    playerFighter.money = 2400;
    playerFighter.armor = 100;
    playerFighter.helmet = true;
    player.teleport(-16, -18, -Math.PI / 2);
    setViewModel('carbine');
    shotStage = { t: 0, freezeAt: 3.1, fired: false };
  } else {
    bomb.site = 'B';
    const carrier = fighters.find((f) => f.team === 'breacher' && f.plan.role === 'planter') ?? fighters.find((f) => f.team === 'breacher');
    bomb.carrier = carrier;
    carrier.plan.site = 'B';
    carrier.body.pos.x = 30;
    carrier.body.pos.z = 21;
    carrier.crouchWanted = true;
    const guards = [[25, 18.5], [36, 15], [27, 25.5], [37, 24]];
    fighters.filter((f) => f.team === 'breacher' && f !== carrier).forEach((f, i) => {
      f.body.pos.x = guards[i][0];
      f.body.pos.z = guards[i][1];
      f.plan.site = 'B';
      // Pin the guards near their posts for the capture.
      f.plan.role = 'holder';
      f.plan.holdNode = nearestNode(map, f.body.pos.x, f.body.pos.z);
    });
    fighters.filter((f) => f.team === 'warden' && !f.isPlayer).forEach((f, i) => {
      f.body.pos.x = [6, 0, -8, 12][i];
      f.body.pos.z = [8, 22, 14, 26][i];
      f.plan.holdNode = [4, 5, 3, 6][i]; // keep Wardens on the A side for this shot
    });
    playerFighter.weapons.primary = makeWeapon('carbine');
    playerFighter.weaponKind = 'primary';
    playerFighter.armor = 100;
    playerFighter.helmet = true;
    player.teleport(18, 14.5, -Math.PI / 2);
    setViewModel('carbine');
    shotStage = { t: 0, freezeAt: 0.95, fired: false };
  }
  refreshHud();
}

function aimPlayerAt(x, y, z) {
  const eye = { x: playerFighter.body.pos.x, y: player.eyeHeight(), z: playerFighter.body.pos.z };
  const dx = x - eye.x;
  const dy = y - eye.y;
  const dz = z - eye.z;
  const targetYaw = Math.atan2(-dx, -dz);
  const targetPitch = Math.atan2(dy, Math.hypot(dx, dz));
  let dyaw = targetYaw - player.viewYaw();
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  // player.look subtracts its argument from yaw, so the sign flips for yaw;
  // pitch rises with a negative dy, which the second argument already is.
  player.look(-dyaw / 0.0021, -(targetPitch - player.viewPitch()) / 0.0021);
}

function shotUpdate(dt) {
  if (!shotStage || shotStage.frozen) return;
  shotStage.t += dt;
  const t = shotStage.t;
  if (shot === 'yard') {
    // The player holds the north lane and opens fire as the push arrives.
    let target = null;
    let bestD = Infinity;
    for (const f of fighters) {
      if (f.team !== 'breacher' || !f.alive) continue;
      if (f.body.pos.x < playerFighter.body.pos.x + 2) continue; // the push still coming, not a leak past
      const d = Math.hypot(f.body.pos.x - playerFighter.body.pos.x, f.body.pos.z - playerFighter.body.pos.z);
      if (d < bestD) { bestD = d; target = f; }
    }
    if (target && t > 1.6) aimPlayerAt(target.body.pos.x, 1.25, target.body.pos.z);
    shotTrigger = t > 2.2;
  } else if (shot === 'plant') {
    const carrier = bomb.carrier;
    if (carrier) {
      carrier.channel = 'plant';
      carrier.channelT = Math.min(PLANT_S - 0.05, carrier.channelT + dt);
      carrier.crouchWanted = true;
      aimPlayerAt(carrier.body.pos.x + 0.9, 1.1, carrier.body.pos.z + 0.3);
      hud.channel('BREACHER PLANTING THE CHARGE', Math.min(1, carrier.channelT / PLANT_S));
    }
    shotTrigger = t > 0.85;
  }
}

// --- the frame loop -----------------------------------------------------------------------
let lastMs = performance.now();
let accumulator = 0;
let framesRendered = 0;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (nowMs - lastMs) / 1000);
  lastMs = nowMs;
  const frozen = shotStage?.frozen === true;
  if (!paused && !frozen && shot) {
    // Screenshot staging runs on a fixed virtual clock — five sim steps per
    // rendered frame — so a capture lands on the same moment whatever the
    // host's frame rate. On the freeze frame the effects are left un-aged,
    // so the tracers and muzzle flash of the final shots stay on screen.
    shotUpdate(5 * FIXED);
    for (let i = 0; i < 5; i++) step(FIXED);
    if (shotStage && shotStage.t >= shotStage.freezeAt) {
      shotStage.frozen = true;
      // Age just past the muzzle flash's 45 ms: the frozen frame keeps the
      // tracers (60 ms) but not the flash quad and its light burst.
      effects.update(0.05);
    } else {
      effects.update(5 * FIXED);
    }
  } else if (!paused && !frozen && started) {
    accumulator += dtReal;
    let steps = 0;
    while (accumulator >= FIXED && steps < 5) {
      step(FIXED);
      accumulator -= FIXED;
      steps += 1;
    }
    if (steps === 5) accumulator = 0;
    effects.update(dtReal);
  }
  syncVisuals(dtReal);
  renderer.render(scene, camera);
  framesRendered += 1;
  input.clearPressed();
  if (shot && framesRendered > 4 && (shot === 'menu' || frozen)) {
    window.__shotReady = true;
  }
}
requestAnimationFrame(frame);
