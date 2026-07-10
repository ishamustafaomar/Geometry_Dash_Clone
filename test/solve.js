/*
 * Completability prover. Run: node test/solve.js [levelIndex]
 *
 * Beam search over the deterministic sim: decisions every 4 substeps (60 Hz),
 * each state branches into hold / release. If the search reaches the finish,
 * the level is beatable and the winning input script is written to
 * js/solutions.js so the game can replay it as the menu attract mode.
 *
 * Exit code is non-zero if any level cannot be solved — treat this file as a
 * test.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var C = require('../js/constants.js');
var SIM = require('../js/sim.js');
var LEVELS = require('../js/levels.js');

var TICK = 4;                 // substeps per decision (60 Hz decisions)
var BEAM = 900;               // states kept per tick
var MAX_SECONDS = 240;        // absolute safety limit

function cloneState(s, needUsedClone) {
  var n = {
    level: s.level,
    x: s.x, y: s.y, vy: s.vy,
    mode: s.mode, speedId: s.speedId, gravDir: s.gravDir,
    grounded: s.grounded, rotation: 0,
    dead: false, won: false,
    time: s.time, step: s.step,
    input: s.input, inputEdge: false, orbLock: s.orbLock,
    contact: s.contact, contactPrev: s.contactPrev,
    usedOnce: needUsedClone ? Object.assign({}, s.usedOnce) : s.usedOnce,
    coins: s.coins,
    coinsThisAttempt: needUsedClone
      ? s.coinsThisAttempt.slice() : s.coinsThisAttempt,
    events: []
  };
  return n;
}

// Does the window ahead contain anything that mutates per-attempt state?
function interactiveAhead(compiled, x) {
  var objs = SIM.queryRange(compiled, x - C.BLOCK, x + C.BLOCK * 4);
  for (var i = 0; i < objs.length; i++) {
    var t = objs[i].type;
    if (SIM.isPad(t) || SIM.isOrb(t) || t === C.T.COIN) return true;
  }
  return false;
}

function key(s) {
  return s.mode + '|' + s.gravDir + '|' + (s.grounded ? 1 : 0) + '|' +
    s.speedId + '|' + (s.input ? 1 : 0) + '|' + (s.orbLock ? 1 : 0) + '|' +
    Math.round(s.y / 2) + '|' + Math.round(s.vy / 15) + '|' +
    (s.coinsThisAttempt[0] ? 1 : 0) + (s.coinsThisAttempt[1] ? 1 : 0) +
    (s.coinsThisAttempt[2] ? 1 : 0);
}

function solve(levelMeta, opts) {
  opts = opts || {};
  // requireCoin: index of a coin that any state must have collected once it
  // is more than a few blocks past the coin — proves the coin is reachable
  // on a run that still finishes the level.
  var requireCoin = opts.requireCoin != null ? opts.requireCoin : -1;
  var coinObj = null;
  var compiled = SIM.compileLevel(levelMeta);
  if (requireCoin >= 0) {
    for (var ci = 0; ci < compiled.objects.length; ci++) {
      var o = compiled.objects[ci];
      if (o.type === C.T.COIN && (o.rot | 0) === requireCoin) coinObj = o;
    }
    if (!coinObj) return { ok: false, deathX: 0, tick: 0, noCoin: true };
  }
  var start = SIM.createState(compiled);
  start.hist = null;

  var beam = [start];
  var maxTicks = Math.ceil(MAX_SECONDS * C.PHYS_HZ / TICK);
  var bestX = start.x;

  for (var tick = 0; tick < maxTicks; tick++) {
    var next = [];
    var seen = {};
    // The clone decision must be per-state: beam candidates can sit at very
    // different x (different speed-portal histories), and sharing a mutable
    // usedOnce dict between siblings corrupts orb/pad consumption.
    var cloneCache = {};

    for (var b = 0; b < beam.length; b++) {
      var st = beam[b];
      var col = Math.floor(st.x / C.BLOCK);
      var needClone = cloneCache[col];
      if (needClone === undefined) {
        needClone = interactiveAhead(compiled, st.x);
        cloneCache[col] = needClone;
      }
      for (var a = 0; a < 2; a++) {
        var input = a === 1;
        var n = cloneState(st, needClone);
        n.hist = (input !== st.input)
          ? { t: tick, v: input, prev: st.hist }
          : st.hist;
        var died = false;
        for (var k = 0; k < TICK; k++) {
          SIM.stepSim(n, input);
          if (n.won) {
            if (requireCoin >= 0 && !n.coinsThisAttempt[requireCoin]) {
              died = true; break;
            }
            return finish(n, tick, levelMeta, opts);
          }
          if (n.dead) { died = true; break; }
        }
        if (died) continue;
        if (requireCoin >= 0 && !n.coinsThisAttempt[requireCoin] &&
            n.x > coinObj.x + coinObj.w + C.BLOCK * 4) {
          continue; // missed the coin — prune this line
        }
        var kk = key(n);
        if (seen[kk]) continue;
        seen[kk] = true;
        next.push(n);
      }
    }

    if (next.length === 0) {
      return { ok: false, deathX: bestX / C.BLOCK, tick: tick };
    }
    if (next.length > BEAM) {
      // Plain solves favour calm, grounded states. Coin solves instead steer
      // the beam toward the coin's altitude while it is still ahead —
      // otherwise high flyers get pruned long before a high coin.
      var score = function (p) {
        if (requireCoin >= 0 && !p.coinsThisAttempt[requireCoin] &&
            p.x < coinObj.x + coinObj.w &&
            coinObj.x - p.x < C.BLOCK * 25) {
          return p.x - Math.abs((p.y + 15) - (coinObj.y + coinObj.h / 2)) * 0.25;
        }
        return p.x + (p.grounded ? 4 : 0) - Math.abs(p.vy) * 0.002;
      };
      next.sort(function (p, q) { return score(q) - score(p); });
      // Stratified truncation: cap how many states any one altitude band may
      // occupy, so score ties can't silently squeeze out e.g. every state
      // that is diving toward the only survivable line.
      var bandCap = Math.max(8, Math.ceil(BEAM / 12));
      var bands = {}, kept = [];
      for (var s2 = 0; s2 < next.length && kept.length < BEAM; s2++) {
        var band = next[s2].mode + ':' + Math.floor(next[s2].y / (C.BLOCK * 1.5)) +
          ':' + (next[s2].vy > 60 ? 1 : next[s2].vy < -60 ? -1 : 0);
        var cnt = bands[band] || 0;
        if (cnt >= bandCap) continue;
        bands[band] = cnt + 1;
        kept.push(next[s2]);
      }
      next = kept;
    }
    beam = next;
    bestX = Math.max(bestX, beam[0].x);
  }
  return { ok: false, deathX: bestX / C.BLOCK, tick: maxTicks, timeout: true };
}

function finish(state, tick, levelMeta, opts) {
  // Reconstruct toggle list (earliest first).
  var toggles = [];
  var h = state.hist;
  while (h) { toggles.push([h.t, h.v ? 1 : 0]); h = h.prev; }
  toggles.reverse();
  return {
    ok: true,
    ticks: tick,
    seconds: (tick * TICK) / C.PHYS_HZ,
    coins: state.coinsThisAttempt.slice(),
    solution: { levelId: levelMeta.id, tickSubsteps: TICK, toggles: toggles }
  };
}

// Replay a solution from scratch to confirm determinism end-to-end.
function verifyReplay(levelMeta, solution) {
  var compiled = SIM.compileLevel(levelMeta);
  var s = SIM.createState(compiled);
  var ti = 0, input = false;
  var maxSteps = MAX_SECONDS * C.PHYS_HZ;
  for (var step = 0; step < maxSteps; step++) {
    var tick = Math.floor(step / solution.tickSubsteps);
    while (ti < solution.toggles.length && solution.toggles[ti][0] <= tick) {
      input = !!solution.toggles[ti][1];
      ti++;
    }
    SIM.stepSim(s, input);
    if (s.won) return true;
    if (s.dead) return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
var only = process.argv[2] != null ? parseInt(process.argv[2], 10) : null;
var solutions = [];
var failed = false;

for (var i = 0; i < LEVELS.length; i++) {
  if (only !== null && i !== only) continue;
  var lvl = LEVELS[i];
  var t0 = Date.now();
  var res = solve(lvl);
  var dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.ok) {
    var replayOk = verifyReplay(lvl, res.solution);
    console.log('SOLVED  ' + lvl.name + '  (' + res.seconds.toFixed(1) +
      's of gameplay, ' + res.solution.toggles.length + ' toggles, search ' +
      dt + 's, replay ' + (replayOk ? 'verified' : 'MISMATCH') + ')');
    if (!replayOk) failed = true;
    solutions.push(res.solution);
  } else {
    failed = true;
    console.error('UNSOLVABLE  ' + lvl.name + '  — search died around x=' +
      res.deathX.toFixed(1) + ' blocks' + (res.timeout ? ' (timeout)' : '') +
      '  (search ' + dt + 's)');
    continue;
  }

  // Prove each secret coin is collectable on a run that still finishes.
  for (var coin = 0; coin < 3; coin++) {
    var tc = Date.now();
    var cres = solve(lvl, { requireCoin: coin });
    var cdt = ((Date.now() - tc) / 1000).toFixed(1);
    if (cres.ok) {
      console.log('  coin ' + (coin + 1) + ' reachable (search ' + cdt + 's)');
    } else {
      failed = true;
      console.error('  coin ' + (coin + 1) + ' UNREACHABLE — search died at x=' +
        cres.deathX.toFixed(1) + ' blocks (search ' + cdt + 's)');
    }
  }
}

if (only === null && !failed) {
  var out = '/* AUTO-GENERATED by test/solve.js — winning input scripts,\n' +
    ' * replayed by the menu attract mode. Do not edit by hand. */\n' +
    '(function (global) {\n' +
    "  'use strict';\n" +
    '  var S = ' + JSON.stringify(solutions) + ';\n' +
    "  if (typeof module !== 'undefined' && module.exports) module.exports = S;\n" +
    '  else global.GD_SOLUTIONS = S;\n' +
    "})(typeof window !== 'undefined' ? window : globalThis);\n";
  fs.writeFileSync(path.join(__dirname, '..', 'js', 'solutions.js'), out);
  console.log('Wrote js/solutions.js');
}

process.exit(failed ? 1 : 0);
