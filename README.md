# PORTFALL — Harbor Breach

A tactical round-based FPS for the browser, built with Three.js. Five
Wardens hold Portside Nine, a container terminal at dusk, against five
Breachers who have come to plant a breach charge on one of two sites: the
Crane Pad or the Cold Store. Rounds run on money — kills and round results
pay, and what you buy in the nine-second freeze (a carbine, armour, a frag)
decides the next ninety seconds.

**Play it:** serve the `game/` folder statically (for example
`node serve.ts`, then open http://localhost:8901/) and click Play. WASD +
mouse, R reloads, B opens the buy menu during the freeze, E holds to
defuse, 3 and 4 throw grenades, Tab shows the scoreboard.

## How this entry is put together

- `main.ts` — the hand-in program. It copies `game/` and `screenshots/`
  into the output directory and writes `dossier.json` through the kit's
  vendored builder (`vendor/makefun-threejs.ts`, untouched).
- `game/` — the game itself: static ES modules, no build step, no network.
  Three.js 0.187.0 is vendored byte-for-byte under `game/vendor/three/`.
  - `src/main.js` — the match: fixed-step simulation, rounds, economy,
    the bomb, hit resolution. One home for state.
  - `src/map.js` — the harbour: containers, crane, warehouse, two sites,
    and the waypoint graph the bots walk.
  - `src/bots.js` — bot brains: perception (sight, sound, memory),
    objective play (plant, escort, hold, defuse), burst-fire combat.
  - `src/player.js` / `src/input.js` — movement (acceleration, crouch,
    walk-quiet, jump) and pointer-lock input.
  - `src/weapons.js` — the five guns and two grenades, with spread that
    punishes movement and rewards planting your feet.
  - `src/characters.js`, `src/effects.js`, `src/audio.js`, `src/hud.js`,
    `src/palette.js`, `src/physics.js` — figures, tracers and blasts,
    synthesized sound, the DOM HUD, the dusk palette, collision and rays.
- `screenshots/` — real renders of this code, captured from its own staged
  `?shot=` modes (menu orbit, a north-lane firefight, a Cold Store plant).
- `serve.ts` + `shots.json` — the local server and the capture list used
  to produce those screenshots.

## The match, in one paragraph

Freeze (9 s, buy) → live (100 s). The Breachers' carrier plants at a site
(3 s channel); the charge then burns 35 s while a Warden tries a 6 s
defuse. Elimination also ends a round — unless the charge is already
planted, in which case it still has to be defused or it fires. Round win
pays $2,700, a loss $1,900, a kill $300. First to 7 rounds, at most 12.

MIT licensed — see `LICENSE`.
