# Geometric Rush

An original rhythm-platformer in the spirit of Geometry Dash — built from
scratch with **zero dependencies, no build step, and no external assets**.
All art is drawn procedurally on canvas, all music is synthesized at runtime
with WebAudio, and every level ships with a machine-checked proof that it can
be beaten.

> **Note on originality:** this is a genre tribute, not a copy. All code,
> level designs, music, and artwork here are original. No assets, audio, or
> level layouts from Geometry Dash (© RobTop Games) are included.

## Play

Open `index.html` in any modern browser, or serve the folder:

```bash
npm start          # http-server on :8080
```

**Controls**

| Input | Action |
|---|---|
| Space / ↑ / W / click / tap | jump · hold to keep jumping · thrust (ship) · flip (ball/wave/UFO) |
| Esc / P | pause |
| Z / X | place / remove checkpoint (practice mode) |

## Features

- **Five game modes** — cube, ship, ball, UFO, wave — switched by portals
  mid-level, plus gravity portals, speed portals (0.5×–4×), jump pads
  (yellow/pink/red/blue) and jump orbs (yellow/pink/red/blue/green/black).
- **Three hand-designed levels** — *Prism Runner* (easy), *Neon Circuit*
  (medium), *Hyper Drift* (hard) — with three secret coins each, beat-synced
  obstacle spacing, and per-section color zones.
- **Deterministic physics** — a pure-JS 240 Hz fixed-timestep core
  (`js/sim.js`) with no DOM dependencies, using community-documented
  genre physics values (30-unit blocks, 311.58 u/s at 1×, ~2.2-block jump).
- **Practice mode** with manual checkpoints, attempts counter, best-%
  progress, and per-level coin persistence (localStorage).
- **Synthesized soundtrack** — four original tracks (one per level + menu)
  written as step-sequencer patterns and rendered live by a WebAudio synth;
  all SFX are synthesized too.
- **Icon kit** — three face styles and 12×2 color combinations for your cube.
- **Level editor** — grid-based placement of every object type, pit tool,
  save/load, and in-engine playtesting.
- **Attract mode** — the main menu plays real solver-generated runs of the
  levels behind the UI.

## Proven completable

`test/solve.js` runs a beam search over the actual game simulation for every
level. If the search cannot reach the finish — or cannot collect any one of
the nine secret coins on a run that still finishes — the test fails. Winning
input scripts are written to `js/solutions.js` and replayed (deterministically,
through the same sim) as the menu attract mode.

```bash
npm test           # physics unit tests + completability proofs
```

`test/unit.js` covers jump metrics, collision rules (wall faces kill, tops
land), hazard hitbox forgiveness, pads vs orbs, portals, wave/ball/ship
behaviors, coins, win conditions, checkpoint restore, and determinism.

## Architecture

```
index.html          canvas + script tags (classic scripts, file:// friendly)
js/constants.js     physics + object-type constants (browser & Node)
js/sim.js           deterministic simulation core (browser & Node)
js/levels.js        level data, built with pattern helpers (browser & Node)
js/solutions.js     AUTO-GENERATED winning inputs (by test/solve.js)
js/audio.js         WebAudio sequencer, instruments, tracks, SFX
js/render.js        canvas renderer + particles (procedural art)
js/main.js          game shell: loop, input, camera, menus, saves
js/editor.js        level editor
test/unit.js        physics unit tests
test/solve.js       beam-search completability prover
```

The sim/levels/constants modules are dual-environment (browser globals or
CommonJS), which is what lets the Node test harness drive the exact code the
browser runs.
