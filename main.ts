// PORTFALL — hand-in program (Node 22, standard library only).
//
// The game itself is the static site under game/: plain ES modules the browser
// loads with three.js from an import map, no build step. This program hands it
// in: it copies game/ and screenshots/ from beside this file into the output
// directory and writes dossier.json there with the vendored make.fun library —
// the same library the scorer runs, so the dossier it writes here is the one
// the gate compares against.
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Pre-flight: the dossier's first screenshot is the cover, so a hand-in with
// no screenshots at all is refused here with a plain message, before any
// copying, instead of failing inside the library halfway through.
const shotNames = existsSync(join(here, 'screenshots'))
  ? readdirSync(join(here, 'screenshots')).filter((n) => /\.(png|jpe?g)$/i.test(n))
  : [];
if (shotNames.length === 0) {
  throw new Error('main.ts: screenshots/ holds no image — capture the staged shots first (see shots.json)');
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The caps are the scorer's own (the kit's reference/gate.json): the text cap
// shapes the dossier's bytes, the rest make this program refuse exactly what
// the scorer would refuse — too many screenshots or one too heavy, a game/
// tree too large or too many files in it.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
