// input.js — keyboard and mouse state for the player, and the pointer-lock
// handshake. The simulation reads a plain state object; nothing here knows
// about the game, and the game never touches the DOM for keys.

export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set(); // keys that went down since the last sim step
  let lookX = 0;
  let lookY = 0;
  let firing = false;
  let locked = false;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') e.preventDefault();
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    firing = false;
  });

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) firing = false;
    onLockChange(locked);
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    lookX += e.movementX || 0;
    lookY += e.movementY || 0;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (locked && e.button === 0) firing = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    keys,
    get locked() {
      return locked;
    },
    get firing() {
      return firing;
    },
    setFiring(v) {
      firing = v;
    },
    // Mouse travel since the last call, in pixels; the caller scales it.
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    // True once per physical press of a code.
    wasPressed(code) {
      return pressed.has(code);
    },
    clearPressed() {
      pressed.clear();
    },
    requestLock() {
      canvas.requestPointerLock();
    },
  };
}
