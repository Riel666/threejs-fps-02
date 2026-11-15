// player.js — the local player's body: mouse look with recoil, and ground
// movement with acceleration and friction in the Counter-Strike shape —
// you are fast or you are accurate, never both, because spread reads the
// same speed this module reports. Crouching is slower and lower; walking
// (Shift) is slower still and silent, which the bots' ears respect.
import { moveBody } from './physics.js';

export const RUN_SPEED = 5.2;
export const WALK_SPEED = 2.7;
export const CROUCH_SPEED = 1.9;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.18;

const ACCEL = 42;
const FRICTION = 9.5;
const GRAVITY = 14.5;
const JUMP_VEL = 4.9;

export function createPlayer(colliders) {
  const body = {
    pos: { x: -46, y: 0, z: 0 },
    radius: 0.38,
  };
  const state = {
    body,
    vel: { x: 0, z: 0 },
    vy: 0,
    yaw: -Math.PI / 2, // facing +x, from the Warden spawn toward mid
    pitch: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    crouch: 0, // 0 standing, 1 fully crouched (eased)
    crouching: false,
    walking: false,
    airborne: false,
    speed: 0,
  };

  function look(dx, dy) {
    state.yaw -= dx * 0.0021;
    state.pitch -= dy * 0.0021;
    const lim = 1.45;
    state.pitch = Math.max(-lim, Math.min(lim, state.pitch));
  }

  function addRecoil(pitchKick, yawKick) {
    state.recoilPitch += pitchKick;
    state.recoilYaw += yawKick;
  }

  // keys: the input module's Set of codes. dt: fixed step.
  function step(dt, keys) {
    const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    state.crouching = wantCrouch;
    state.crouch += ((wantCrouch ? 1 : 0) - state.crouch) * Math.min(1, dt * 11);
    state.walking = keys.has('ShiftLeft') || keys.has('ShiftRight');

    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    let ix = 0;
    let iz = 0;
    if (keys.has('KeyW')) iz -= 1;
    if (keys.has('KeyS')) iz += 1;
    if (keys.has('KeyA')) ix -= 1;
    if (keys.has('KeyD')) ix += 1;
    // Camera forward on the ground plane is (-sin(yaw), -cos(yaw)) for the
    // three.js YXZ convention this game uses.
    const wishX = -sin * -iz + -cos * ix * -1;
    const wishZ = -cos * -iz + sin * ix * -1;
    const wishLen = Math.hypot(wishX, wishZ);
    const maxSpeed = state.crouching ? CROUCH_SPEED : state.walking ? WALK_SPEED : RUN_SPEED;

    if (wishLen > 0.01) {
      const nx = wishX / wishLen;
      const nz = wishZ / wishLen;
      state.vel.x += nx * ACCEL * dt;
      state.vel.z += nz * ACCEL * dt;
      const sp = Math.hypot(state.vel.x, state.vel.z);
      if (sp > maxSpeed) {
        state.vel.x *= maxSpeed / sp;
        state.vel.z *= maxSpeed / sp;
      }
    } else {
      const drop = Math.max(0, 1 - FRICTION * dt);
      state.vel.x *= drop;
      state.vel.z *= drop;
      if (Math.hypot(state.vel.x, state.vel.z) < 0.02) {
        state.vel.x = 0;
        state.vel.z = 0;
      }
    }

    if (keys.has('Space') && !state.airborne) {
      state.vy = JUMP_VEL;
      state.airborne = true;
    }
    if (state.airborne) {
      state.vy -= GRAVITY * dt;
      body.pos.y += state.vy * dt;
      if (body.pos.y <= 0) {
        body.pos.y = 0;
        state.vy = 0;
        state.airborne = false;
      }
    }

    moveBody(body, state.vel.x * dt, state.vel.z * dt, colliders);
    // The yard is fenced; keep the body inside it whatever happens.
    body.pos.x = Math.max(-50.6, Math.min(50.6, body.pos.x));
    body.pos.z = Math.max(-36.6, Math.min(36.6, body.pos.z));
    state.speed = Math.hypot(state.vel.x, state.vel.z);

    // Recoil is a spring: it kicks the view up and settles back, so a burst
    // climbs and a paused trigger recovers your aim.
    state.recoilPitch *= Math.max(0, 1 - dt * 7.5);
    state.recoilYaw *= Math.max(0, 1 - dt * 7.5);
  }

  return {
    state,
    look,
    addRecoil,
    step,
    eyeHeight() {
      return EYE_STAND + (EYE_CROUCH - EYE_STAND) * state.crouch;
    },
    viewPitch() {
      return state.pitch + state.recoilPitch;
    },
    viewYaw() {
      return state.yaw + state.recoilYaw;
    },
    teleport(x, z, yaw) {
      body.pos.x = x;
      body.pos.z = z;
      body.pos.y = 0;
      state.vel.x = 0;
      state.vel.z = 0;
      state.yaw = yaw;
      state.pitch = 0;
      state.recoilPitch = 0;
      state.recoilYaw = 0;
    },
  };
}
