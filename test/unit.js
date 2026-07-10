/*
 * Physics unit tests. Run: node test/unit.js
 * No framework — each check throws on failure and the script exits non-zero.
 */
'use strict';

var C = require('../js/constants.js');
var SIM = require('../js/sim.js');
var T = C.T, MODE = C.MODE;

var failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok  ' + name); return; }
  failures++;
  console.error('FAIL  ' + name + (detail ? ' — ' + detail : ''));
}

function mkLevel(objects, extra) {
  var meta = Object.assign({
    id: 'test', name: 'test', bpm: 120, musicId: 0,
    startMode: MODE.CUBE, startSpeed: 1, ceiling: 11,
    pits: {}, zones: [], objects: objects
  }, extra || {});
  return SIM.compileLevel(meta);
}

// Runs the sim with an input function of (step) -> bool, up to maxSteps.
function run(state, inputFn, maxSteps) {
  for (var i = 0; i < maxSteps; i++) {
    SIM.stepSim(state, inputFn ? !!inputFn(i) : false);
    if (state.dead || state.won) break;
  }
  return state;
}

// --- 1. Flat ground run: survives and advances at the expected speed ------
(function () {
  var lvl = mkLevel([{ t: T.FINISH, x: 200, y: 0, w: 1, h: 14 }]);
  var s = SIM.createState(lvl);
  var x0 = s.x;
  run(s, null, 240); // exactly one second
  var dx = s.x - x0;
  check('flat run survives', !s.dead);
  check('speed 1x ~311.58 u/s', Math.abs(dx - C.SPEEDS[1]) < 0.001, 'dx=' + dx);
})();

// --- 2. Jump height and distance ------------------------------------------
(function () {
  var lvl = mkLevel([{ t: T.FINISH, x: 400, y: 0, w: 1, h: 14 }]);
  var s = SIM.createState(lvl);
  run(s, null, 24); // settle
  var jumpX = null, maxY = 0, landX = null;
  for (var i = 0; i < 400; i++) {
    var press = i === 0;
    var wasGrounded = s.grounded;
    SIM.stepSim(s, press);
    if (press) jumpX = s.x;
    if (s.y > maxY) maxY = s.y;
    if (!wasGrounded && s.grounded && landX === null) { landX = s.x; break; }
  }
  check('jump height ~65 units', maxY > 58 && maxY < 68, 'maxY=' + maxY);
  check('jump length ~4 blocks', landX - jumpX > 110 && landX - jumpX < 130,
    'len=' + (landX - jumpX));
})();

// --- 3. Wall face kills; landing on top survives ---------------------------
(function () {
  var lvl = mkLevel([{ t: T.BLOCK, x: 10, y: 0, w: 4, h: 1 }]);
  var s = SIM.createState(lvl);
  s.x = 8 * C.BLOCK;
  run(s, null, 240);
  check('running into wall face dies', s.dead);

  var s2 = SIM.createState(lvl);
  s2.x = 6.2 * C.BLOCK;
  var landed = false;
  for (var i = 0; i < 400; i++) {
    SIM.stepSim(s2, i === 0);
    if (s2.dead) break;
    if (s2.grounded && s2.y === C.BLOCK) { landed = true; break; }
  }
  check('jump onto block lands on top', landed && !s2.dead,
    'dead=' + s2.dead + ' y=' + s2.y);
})();

// --- 4. Spike kills on centre, forgives a graze ----------------------------
(function () {
  var lvl = mkLevel([{ t: T.SPIKE, x: 12, y: 0, w: 1, h: 1 }]);
  var s = SIM.createState(lvl);
  run(s, null, 3000);
  check('spike kills a grounded runner', s.dead && !s.won);

  // Jumping at a sensible spot clears it.
  var s2 = SIM.createState(lvl);
  var res = run(s2, function (i) {
    var xb = s2.x / C.BLOCK;
    return xb > 9.2 && xb < 9.6;
  }, 4000);
  check('spike is jumpable', !res.dead, 'died at x=' + res.x / C.BLOCK);
})();

// --- 5. Pads bounce without input; orbs need input --------------------------
(function () {
  var lvl = mkLevel([{ t: T.PAD_YELLOW, x: 10, y: 0, w: 1, h: 0.4 }]);
  var s = SIM.createState(lvl);
  var maxY = 0;
  for (var i = 0; i < 600; i++) { SIM.stepSim(s, false); maxY = Math.max(maxY, s.y); }
  check('yellow pad launches (no input)', maxY > 100, 'maxY=' + maxY);

  var lvl2 = mkLevel([{ t: T.ORB_YELLOW, x: 10, y: 0.5, w: 1, h: 1 }]);
  var s2 = SIM.createState(lvl2);
  var maxY2 = 0;
  for (var j = 0; j < 600; j++) { SIM.stepSim(s2, false); maxY2 = Math.max(maxY2, s2.y); }
  check('orb ignored without input', maxY2 < 1, 'maxY=' + maxY2);

  var s3 = SIM.createState(lvl2);
  var maxY3 = 0;
  for (var k = 0; k < 600; k++) {
    // Hold from shortly before the orb — buffered activation.
    SIM.stepSim(s3, s3.x / C.BLOCK > 9.0);
    maxY3 = Math.max(maxY3, s3.y);
  }
  check('orb fires while held', maxY3 > 50, 'maxY=' + maxY3);
})();

// --- 6. Portals: mode switch, gravity flip, speed change --------------------
(function () {
  var lvl = mkLevel([
    { t: T.PORTAL_SHIP, x: 8, y: 0, w: 1, h: 4 },
    { t: T.SPEED_2, x: 12, y: 0, w: 1, h: 2 },
    { t: T.PORTAL_GRAV_UP, x: 16, y: 0, w: 1, h: 4 }
  ]);
  var s = SIM.createState(lvl);
  var runPast = function (blocks) {
    for (var i = 0; i < 20000 && s.x < blocks * C.BLOCK && !s.dead; i++) {
      SIM.stepSim(s, false);
    }
  };
  runPast(10);
  check('ship portal switches mode', s.mode === MODE.SHIP);
  runPast(14);
  check('speed portal applies', s.speedId === 2, 'speedId=' + s.speedId);
  runPast(18);
  check('gravity portal flips', s.gravDir === -1);
})();

// --- 7. Wave dies on blocks, slides on the raw ground -----------------------
(function () {
  var lvl = mkLevel([
    { t: T.PORTAL_WAVE, x: 5, y: 0, w: 1, h: 4 },
    { t: T.BLOCK, x: 14, y: 0, w: 2, h: 3 }
  ]);
  var s = SIM.createState(lvl);
  run(s, null, 2000);
  check('wave slides on ground then dies on block', s.dead, 'x=' + s.x / C.BLOCK);
  check('wave died at the block, not before', s.x / C.BLOCK > 12,
    'x=' + s.x / C.BLOCK);
})();

// --- 8. Ball flips per contact while held -----------------------------------
(function () {
  var lvl = mkLevel([
    { t: T.PORTAL_BALL, x: 5, y: 0, w: 1, h: 4 },
    { t: T.BLOCK, x: 6, y: 4, w: 40, h: 4 }
  ]);
  var s = SIM.createState(lvl);
  var flips = 0;
  for (var i = 0; i < 2400 && !s.dead; i++) {
    SIM.stepSim(s, true); // hold the whole time
    for (var e = 0; e < s.events.length; e++) {
      if (s.events[e].name === 'ballflip') flips++;
    }
    s.events.length = 0;
  }
  check('held ball flips repeatedly', flips >= 3, 'flips=' + flips);
})();

// --- 9. Coins and finish -----------------------------------------------------
(function () {
  var lvl = mkLevel([
    { t: T.COIN, x: 10, y: 0, w: 1, h: 1, rot: 1 },
    { t: T.FINISH, x: 20, y: 0, w: 1, h: 14 }
  ]);
  var s = SIM.createState(lvl);
  var got = false;
  for (var i = 0; i < 4000 && !s.won; i++) {
    SIM.stepSim(s, false);
    for (var e = 0; e < s.events.length; e++) {
      if (s.events[e].name === 'coin' && s.events[e].data === 1) got = true;
    }
    s.events.length = 0;
  }
  check('coin collected', got);
  check('finish wins', s.won);
})();

// --- 10. Determinism ---------------------------------------------------------
(function () {
  var mk = function () {
    return mkLevel([
      { t: T.SPIKE, x: 12, y: 0, w: 1, h: 1 },
      { t: T.PAD_YELLOW, x: 18, y: 0, w: 1, h: 0.4 },
      { t: T.PORTAL_SHIP, x: 26, y: 0, w: 1, h: 4 },
      { t: T.FINISH, x: 60, y: 0, w: 1, h: 14 }
    ]);
  };
  var trace = function () {
    var s = SIM.createState(mk());
    var h = 0;
    for (var i = 0; i < 5000 && !s.dead && !s.won; i++) {
      SIM.stepSim(s, (i % 97) < 20);
      h = (h * 31 + Math.round(s.y * 16) + (s.dead ? 7 : 0)) | 0;
    }
    return h + ':' + s.x.toFixed(6) + ':' + s.y.toFixed(6);
  };
  check('two identical runs produce identical traces', trace() === trace());
})();

// --- 11. Checkpoint restore --------------------------------------------------
(function () {
  var lvl = mkLevel([{ t: T.FINISH, x: 100, y: 0, w: 1, h: 14 }]);
  var s = SIM.createState(lvl);
  run(s, null, 500);
  var cp = SIM.makeCheckpoint(s);
  var s2 = SIM.createState(lvl, { checkpoint: cp });
  check('checkpoint restores position', s2.x === s.x && s2.y === s.y);
})();

console.log('');
if (failures) {
  console.error(failures + ' unit test(s) FAILED');
  process.exit(1);
}
console.log('All unit tests passed.');
