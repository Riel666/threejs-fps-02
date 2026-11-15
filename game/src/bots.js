// bots.js — the nine fighters nobody is holding a mouse for. Each bot runs
// the same loop a player would: look, remember, decide, move. Perception is
// honest — a bot knows an enemy's position only if it has seen them (vision
// cone and line of sight) or heard them (gunfire, running feet) — and its aim
// is a human-ish error that settles the longer it tracks a target and the
// stiller it stands.
//
// The brain writes intents onto its fighter (moveVec, moveSpeed, aimYaw,
// aimPitch, triggerHeld, channel); main.js executes them with the same code
// the player's body and gun use, so a bot's bullets obey the same rules.
import { hasLineOfSight } from './physics.js';
import { findPath, nearestNode } from './map.js';

const SIGHT_RANGE = 58;
const FOV_COS = Math.cos(1.45); // ~83 degrees each way
const HEAR_SHOTS = 34;
const HEAR_STEPS = 9;

export function createBot(fighter, map, rng) {
  const brain = {
    fighter,
    path: [],
    pathI: 0,
    goalNode: -1,
    memory: new Map(), // fighter -> {x, z, t}
    target: null,
    targetSince: 0,
    lastSawTargetAt: -9,
    thinkAt: rng() * 0.12,
    repathAt: 0,
    burstUntil: 0,
    pauseUntil: 0,
    reactionUntil: 0,
    state: 'advance',
    holdYaw: fighter.yaw,
    seed: rng(),
  };

  function eyePos(f) {
    return { x: f.body.pos.x, y: 1.52, z: f.body.pos.z };
  }

  function perceive(now, ctx) {
    const me = fighter;
    const seen = [];
    for (const other of ctx.fighters) {
      if (!other.alive || other.team === me.team) continue;
      const dx = other.body.pos.x - me.body.pos.x;
      const dz = other.body.pos.z - me.body.pos.z;
      const dist = Math.hypot(dx, dz);
      let sensed = false;
      if (dist < SIGHT_RANGE) {
        const fx = -Math.sin(me.yaw);
        const fz = -Math.cos(me.yaw);
        const dot = dist > 0.01 ? (dx * fx + dz * fz) / dist : 1;
        if (dot > FOV_COS || dist < 6.5) {
          const chest = { x: other.body.pos.x, y: 1.22, z: other.body.pos.z };
          if (hasLineOfSight(eyePos(me), chest, ctx.colliders)) sensed = true;
        }
        if (!sensed && other.speedNow > 4 && dist < HEAR_STEPS) sensed = true;
      }
      if (sensed) {
        brain.memory.set(other, { x: other.body.pos.x, z: other.body.pos.z, t: now });
        seen.push(other);
      }
    }
    // Gunfire is information: remember where the last enemy shot came from.
    for (const n of ctx.noise) {
      if (n.team === me.team || now - n.t > 0.3) continue;
      const d = Math.hypot(n.x - me.body.pos.x, n.z - me.body.pos.z);
      if (d < HEAR_SHOTS) {
        // Attribute the noise to the nearest living enemy, approximately.
        let best = null;
        let bestD = Infinity;
        for (const other of ctx.fighters) {
          if (!other.alive || other.team === me.team) continue;
          const dd = Math.hypot(other.body.pos.x - n.x, other.body.pos.z - n.z);
          if (dd < bestD) {
            bestD = dd;
            best = other;
          }
        }
        if (best) brain.memory.set(best, { x: n.x, z: n.z, t: n.t });
      }
    }
    // Pick the freshest, closest remembered enemy as the target.
    let bestTarget = null;
    let bestScore = -Infinity;
    for (const [other, mem] of brain.memory) {
      if (!other.alive) continue;
      const age = now - mem.t;
      if (age > 4) continue;
      const d = Math.hypot(mem.x - me.body.pos.x, mem.z - me.body.pos.z);
      const score = (seen.includes(other) ? 100 : 0) - d - age * 6;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = other;
      }
    }
    if (bestTarget !== brain.target) {
      brain.target = bestTarget;
      brain.targetSince = now;
      brain.reactionUntil = now + 0.26 + brain.seed * 0.24;
    }
    if (bestTarget && seen.includes(bestTarget)) brain.lastSawTargetAt = now;
    return seen;
  }

  function setGoal(nodeIdx, now) {
    if (nodeIdx === brain.goalNode && brain.path.length > 0) return;
    brain.goalNode = nodeIdx;
    const from = nearestNode(map, fighter.body.pos.x, fighter.body.pos.z);
    brain.path = findPath(map, from, nodeIdx) ?? [nodeIdx];
    brain.pathI = brain.path.length > 1 ? 1 : 0;
    brain.repathAt = now + 0.7;
  }

  // Walk the path; returns true when the final node is reached.
  function followPath(dt, speed) {
    const me = fighter;
    if (brain.pathI >= brain.path.length) return true;
    const node = map.nodes[brain.path[brain.pathI]];
    const dx = node.x - me.body.pos.x;
    const dz = node.z - me.body.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.7) {
      brain.pathI += 1;
      return brain.pathI >= brain.path.length;
    }
    me.moveVec.x = dx / dist;
    me.moveVec.z = dz / dist;
    me.moveSpeed = speed;
    me.aimYaw = Math.atan2(-me.moveVec.x, -me.moveVec.z);
    return false;
  }

  function faceToward(x, z) {
    const me = fighter;
    me.aimYaw = Math.atan2(-(x - me.body.pos.x), -(z - me.body.pos.z));
  }

  function step(dt, now, ctx) {
    const me = fighter;
    me.moveVec.x = 0;
    me.moveVec.z = 0;
    me.moveSpeed = 0;
    me.triggerHeld = false;
    me.channel = null;
    me.crouchWanted = false;
    if (!me.alive) return;

    if (now >= brain.thinkAt) {
      brain.thinkAt = now + 0.12;
      perceive(now, ctx);
    }

    const plan = me.plan;
    const bomb = ctx.bomb;
    const targetMem = brain.target ? brain.memory.get(brain.target) : null;
    const targetFresh = targetMem && now - targetMem.t < 2.2;
    const targetVisible = brain.target && brain.target.alive && now - brain.lastSawTargetAt < 0.25;

    // --- channel work first: planting and defusing are commitments --------
    if (me.team === 'breacher' && bomb.state === 'carried' && bomb.carrier === me) {
      const site = ctx.sites[plan.site === 'B' ? 1 : 0];
      const d = Math.hypot(me.body.pos.x - site.x, me.body.pos.z - site.z);
      if (d < site.r - 1.6) {
        me.channel = 'plant';
        me.crouchWanted = true;
        faceToward(me.body.pos.x - 6, site.z); // watch back toward the Warden half
        return;
      }
    }
    if (me.team === 'warden' && bomb.state === 'planted' && plan.defuser) {
      const d = Math.hypot(me.body.pos.x - bomb.x, me.body.pos.z - bomb.z);
      if (d < 2.1) {
        me.channel = 'defuse';
        me.crouchWanted = true;
        faceToward(bomb.x, bomb.z);
        if (!targetVisible) return;
      }
    }

    // --- combat: a fresh target interrupts everything but a channel -------
    if (targetFresh && brain.target) {
      const t = brain.target;
      const mem = targetMem;
      const dx = mem.x - me.body.pos.x;
      const dz = mem.z - me.body.pos.z;
      const dist = Math.hypot(dx, dz);
      faceToward(mem.x, mem.z);
      me.aimTargetPos = { x: mem.x, y: me.weaponKind === 'longshot' ? 1.42 : 1.24, z: mem.z };
      const trackTime = now - brain.targetSince;
      me.aimError = Math.max(0.011, 0.055 - trackTime * 0.05);
      if (targetVisible && now >= brain.reactionUntil) {
        if (now >= brain.pauseUntil && now >= brain.burstUntil) {
          const burstLen = me.weaponKind === 'sidearm' || me.weaponKind === 'longshot' ? 0.12 : 0.3 + brain.seed * 0.3;
          brain.burstUntil = now + burstLen;
          brain.pauseUntil = brain.burstUntil + 0.28 + brain.seed * 0.4;
        }
        me.triggerHeld = now < brain.burstUntil;
      }
      if (dist > 15) {
        // Close the distance, firing on the move and paying for it in spread.
        me.moveVec.x = dx / dist;
        me.moveVec.z = dz / dist;
        me.moveSpeed = 3.4;
      } else if (dist < 5 && me.hp < 35) {
        me.moveVec.x = -dx / dist;
        me.moveVec.z = -dz / dist;
        me.moveSpeed = 3.2;
      } else {
        // In range: stop, sometimes crouch, and let the spread settle.
        me.moveSpeed = 0;
        me.crouchWanted = brain.seed > 0.55;
        // Small strafe between bursts to stay a harder target.
        if (!me.triggerHeld && now > brain.pauseUntil - 0.2) {
          const s = brain.seed > 0.5 ? 1 : -1;
          me.moveVec.x = -dz / dist * s;
          me.moveVec.z = dx / dist * s;
          me.moveSpeed = 1.6;
        }
      }
      return;
    }

    // --- objectives ---------------------------------------------------------
    if (bomb.state === 'planted') {
      const siteIdx = bomb.site === 'B' ? 1 : 0;
      if (me.team === 'warden') {
        setGoal(nearestNode(map, bomb.x, bomb.z), now);
        followPath(dt, 4.7);
      } else {
        // Breachers hold the site they planted on.
        const site = ctx.sites[siteIdx];
        const cover = nearestCoverNear(site.x, site.z);
        setGoal(cover, now);
        if (followPath(dt, 4.4)) holdAngle(ctx);
      }
      return;
    }
    if (bomb.state === 'dropped' && me.team === 'breacher') {
      setGoal(nearestNode(map, bomb.x, bomb.z), now);
      followPath(dt, 4.7);
      return;
    }

    if (plan.role === 'planter' || plan.role === 'escort') {
      const site = ctx.sites[plan.site === 'B' ? 1 : 0];
      setGoal(nearestNode(map, site.x, site.z), now);
      if (followPath(dt, plan.role === 'planter' ? 4.7 : 4.4)) holdAngle(ctx);
      return;
    }
    // Warden holders: get to the assigned cover node and watch the lane.
    setGoal(plan.holdNode, now);
    if (followPath(dt, 4.5)) holdAngle(ctx);
  }

  function nearestCoverNear(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < map.nodes.length; i++) {
      if (!map.nodes[i].cover) continue;
      const d = (map.nodes[i].x - x) ** 2 + (map.nodes[i].z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function holdAngle(ctx) {
    const me = fighter;
    me.moveSpeed = 0;
    me.crouchWanted = brain.seed > 0.4;
    // Watch toward the enemy's half of the map: Wardens look east, Breachers west.
    faceToward(me.team === 'warden' ? 46 : -46, me.body.pos.z * 0.4);
  }

  return { step, brain };
}
