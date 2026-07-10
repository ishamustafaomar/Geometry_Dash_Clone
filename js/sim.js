/*
 * Geometric Rush — deterministic simulation core.
 *
 * Pure logic: no DOM, no rendering, no audio. The same code drives the
 * browser game and the Node completability solver, so every change here is
 * automatically re-proven by `node test/solve.js`.
 *
 * Coordinate system: x grows rightward, y grows UPWARD (0 = ground surface).
 * The renderer flips y for the screen.
 */
(function (global) {
  'use strict';

  var C = (typeof module !== 'undefined' && module.exports)
    ? require('./constants.js')
    : global.GD_CONST;
  var T = C.T, MODE = C.MODE;

  // ---------------------------------------------------------------------
  // Level compilation: raw object list -> spatially bucketed lookup.
  // ---------------------------------------------------------------------
  function compileLevel(level) {
    var objs = [];
    for (var i = 0; i < level.objects.length; i++) {
      var o = level.objects[i];
      var b = C.BLOCK;
      var co = {
        id: i,
        type: o.t,
        // World-space rect (x,y = lower-left corner, in units)
        x: o.x * b,
        y: o.y * b,
        w: (o.w || 1) * b,
        h: (o.h || 1) * b,
        rot: o.rot || 0
      };
      if (o.t === T.HALF) { co.y += b / 2; co.h = b / 2; }
      objs.push(co);
    }
    // Bucket by block column for O(1) queries.
    var buckets = {};
    for (var j = 0; j < objs.length; j++) {
      var ob = objs[j];
      var c0 = Math.floor(ob.x / C.BLOCK) - 1;
      var c1 = Math.floor((ob.x + ob.w) / C.BLOCK) + 1;
      for (var c = c0; c <= c1; c++) {
        (buckets[c] || (buckets[c] = [])).push(ob);
      }
    }
    var lengthUnits = 0;
    for (var k = 0; k < objs.length; k++) {
      lengthUnits = Math.max(lengthUnits, objs[k].x + objs[k].w);
    }
    return {
      meta: level,
      objects: objs,
      buckets: buckets,
      lengthUnits: lengthUnits,
      startMode: level.startMode != null ? level.startMode : MODE.CUBE,
      startSpeed: level.startSpeed != null ? level.startSpeed : 1
    };
  }

  function queryRange(compiled, x0, x1) {
    var c0 = Math.floor(x0 / C.BLOCK) - 1;
    var c1 = Math.floor(x1 / C.BLOCK) + 1;
    var out = [];
    var seen = {};
    for (var c = c0; c <= c1; c++) {
      var list = compiled.buckets[c];
      if (!list) continue;
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (!seen[o.id]) { seen[o.id] = true; out.push(o); }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Simulation state
  // ---------------------------------------------------------------------
  function createState(compiled, opts) {
    opts = opts || {};
    var s = {
      level: compiled,
      x: -C.BLOCK * 12,               // run-up before the level content
      y: 0,                            // player lower edge
      vy: 0,
      mode: compiled.startMode,
      speedId: compiled.startSpeed,
      gravDir: 1,                      // 1 = normal (down is -y), -1 = inverted
      grounded: true,
      rotation: 0,                     // cube visual spin (radians)
      dead: false,
      won: false,
      time: 0,
      step: 0,
      input: false,
      inputEdge: false,               // true only on the substep input went down
      orbLock: false,                 // require release before another orb fires
      contact: true,                  // touching a surface this substep
      contactPrev: true,              // ... and the previous one (edge detect)
      usedOnce: {},                   // one-shot objects consumed this attempt
      coins: opts.coins ? opts.coins.slice() : [{}, {}, {}].map(function () { return false; }),
      coinsThisAttempt: [false, false, false],
      events: []                       // drained by renderer/audio each frame
    };
    if (opts.checkpoint) {
      var cp = opts.checkpoint;
      s.x = cp.x; s.y = cp.y; s.vy = cp.vy; s.mode = cp.mode;
      s.speedId = cp.speedId; s.gravDir = cp.gravDir; s.grounded = cp.grounded;
    }
    return s;
  }

  function makeCheckpoint(s) {
    return {
      x: s.x, y: s.y, vy: s.vy, mode: s.mode,
      speedId: s.speedId, gravDir: s.gravDir, grounded: s.grounded
    };
  }

  function playerSize(s) {
    return s.mode === MODE.WAVE ? C.WAVE.size : C.CUBE.size;
  }

  function emit(s, name, data) {
    s.events.push({ name: name, x: s.x, y: s.y, data: data });
  }

  function die(s, why) {
    if (s.dead || s.won) return;
    s.dead = true;
    emit(s, 'death', why);
  }

  // Rect overlap helper. Player rect is (px, py, sz, sz).
  function overlaps(px, py, pw, ph, o) {
    return px < o.x + o.w && px + pw > o.x && py < o.y + o.h && py + ph > o.y;
  }

  function hazardRect(o) {
    // Hazards use a forgiving, centred hitbox like the classic games do.
    if (o.type === T.SPIKE || o.type === T.SPIKE_DOWN) {
      var w = C.BLOCK * C.SPIKE_HIT_W, h = C.BLOCK * C.SPIKE_HIT_H;
      var y = o.type === T.SPIKE ? o.y : o.y + o.h - h;
      return { x: o.x + (o.w - w) / 2, y: y, w: w, h: h };
    }
    if (o.type === T.SMALL_SPIKE) {
      var w2 = C.BLOCK * C.SPIKE_HIT_W, h2 = C.BLOCK * C.SPIKE_HIT_H * 0.5;
      return { x: o.x + (o.w - w2) / 2, y: o.y, w: w2, h: h2 };
    }
    if (o.type === T.SAW) {
      var r = (o.w / 2) * C.SAW_HIT_R;
      return { x: o.x + o.w / 2 - r, y: o.y + o.h / 2 - r, w: r * 2, h: r * 2 };
    }
    return o;
  }

  function isSolid(t) { return t === T.BLOCK || t === T.HALF; }
  function isHazard(t) {
    return t === T.SPIKE || t === T.SPIKE_DOWN || t === T.SMALL_SPIKE || t === T.SAW;
  }
  function isPortal(t) { return t >= T.PORTAL_CUBE && t <= T.PORTAL_GRAV_DOWN; }
  function isSpeed(t) { return t >= T.SPEED_05 && t <= T.SPEED_4; }
  function isPad(t) { return t >= T.PAD_YELLOW && t <= T.PAD_RED; }
  function isOrb(t) { return t >= T.ORB_YELLOW && t <= T.ORB_BLACK; }

  // ---------------------------------------------------------------------
  // One 240 Hz substep.
  // input: whether jump/thrust is held during this substep.
  // ---------------------------------------------------------------------
  function stepSim(s, input) {
    if (s.dead || s.won) return;

    s.inputEdge = input && !s.input;
    if (!input) s.orbLock = false;
    s.input = input;
    s.contactPrev = s.contact;
    s.contact = false;

    var dt = C.PHYS_DT;
    var sz = playerSize(s);
    var speed = C.SPEEDS[s.speedId];
    var g = s.gravDir;

    // ---- Mode physics: set vy ----
    if (s.mode === MODE.CUBE) {
      if (s.grounded && input) {
        s.vy = C.CUBE.jumpVel * g;
        s.grounded = false;
        emit(s, 'jump');
      }
      if (!s.grounded) {
        s.vy -= C.CUBE.gravity * g * dt;
        s.vy = clampFall(s.vy, g, C.CUBE.maxFall);
        s.rotation += 5.6 * g * dt; // ~half turn per full jump
      }
    } else if (s.mode === MODE.SHIP) {
      var acc = input ? C.SHIP.thrust : -C.SHIP.gravity;
      s.vy += acc * g * dt;
      if (s.vy * g > C.SHIP.maxUp) s.vy = C.SHIP.maxUp * g;
      if (s.vy * g < -C.SHIP.maxDown) s.vy = -C.SHIP.maxDown * g;
      s.grounded = false;
    } else if (s.mode === MODE.BALL) {
      // Holding flips once per surface contact (grounded clears immediately
      // after a flip), which matches how the classic ball behaves.
      if (s.grounded && input) {
        s.gravDir = -s.gravDir;
        g = s.gravDir;
        s.grounded = false;
        s.vy = -60 * g;
        emit(s, 'ballflip');
      }
      if (!s.grounded) {
        s.vy -= C.BALL.gravity * g * dt;
        s.vy = clampFall(s.vy, g, C.BALL.maxFall);
      }
      s.rotation += (speed / 15) * dt * g;
    } else if (s.mode === MODE.UFO) {
      if (s.inputEdge && !s.orbLock) {
        s.vy = C.UFO.jumpVel * g;
        emit(s, 'ufojump');
      }
      s.vy -= C.UFO.gravity * g * dt * 0.8;
      s.vy = clampFall(s.vy, g, C.UFO.maxFall);
      s.grounded = false;
    } else if (s.mode === MODE.WAVE) {
      s.vy = (input ? speed : -speed) * g;
      s.grounded = false;
    }

    // ---- Integrate ----
    var prevY = s.y;
    s.x += speed * dt;
    s.y += s.vy * dt;

    // ---- Ground / ceiling ----
    var ceil = groundCeil(s);
    if (s.y <= ceil.floor) {
      // Only land if we were at/above the floor last substep. A player deep
      // inside a pit whose centre drifts over the far lip smacks into the
      // pit wall instead of teleporting up through it.
      if (prevY < ceil.floor - 4) { die(s, 'pit-wall'); return; }
      if (s.mode === MODE.WAVE && ceil.floor > C.GROUND_Y - 0.5 && ceil.floorIsBlock) {
        die(s, 'wave-floor');
        return;
      }
      s.y = ceil.floor;
      if (s.vy < 0) s.vy = 0;
      landIfFalling(s, 1);
    }
    if (s.y + sz >= ceil.ceil) {
      if (s.mode === MODE.WAVE && ceil.ceilIsBlock) { die(s, 'wave-ceil'); return; }
      s.y = ceil.ceil - sz;
      if (s.vy > 0) s.vy = 0;
      landIfFalling(s, -1);
    }

    // ---- Object collisions ----
    var px = s.x, py = s.y;
    var objs = queryRange(s.level, px - C.BLOCK, px + sz + C.BLOCK);
    var innerPad = sz * C.INNER_FRAC;

    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      var t = o.type;

      if (isSolid(t)) {
        if (!overlaps(px, py, sz, sz, o)) continue;
        if (s.mode === MODE.WAVE) { die(s, 'wave-block'); return; }
        var pen = solidResolve(s, o, prevY, sz, innerPad);
        if (pen === 'die') { die(s, 'block'); return; }
        py = s.y;
      } else if (isHazard(t)) {
        var hr = hazardRect(o);
        // Player hazard hitbox is slightly smaller than the physical box.
        var shrink = sz * 0.14;
        if (overlaps(px + shrink, py + shrink, sz - 2 * shrink, sz - 2 * shrink, hr)) {
          die(s, 'hazard'); return;
        }
      } else if (isPortal(t)) {
        if (!overlaps(px, py, sz, sz, o)) continue;
        applyPortal(s, o);
      } else if (isSpeed(t)) {
        if (!overlaps(px, py, sz, sz, o)) continue;
        var id = t - T.SPEED_05;
        if (s.speedId !== id) { s.speedId = id; emit(s, 'speed', id); }
      } else if (isPad(t)) {
        if (s.usedOnce[o.id]) continue;
        if (!overlaps(px, py, sz, sz, o)) continue;
        s.usedOnce[o.id] = true;
        applyPad(s, o);
      } else if (isOrb(t)) {
        if (s.usedOnce[o.id]) continue;
        if (!s.input || s.orbLock) continue;
        var cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        var pcx = px + sz / 2, pcy = py + sz / 2;
        var dx = cx - pcx, dy = cy - pcy;
        if (dx * dx + dy * dy > C.ORB_RADIUS * C.ORB_RADIUS) continue;
        s.usedOnce[o.id] = true;
        s.orbLock = true;
        applyOrb(s, o);
      } else if (t === T.COIN) {
        var ci = o.rot | 0; // coin index stored in rot field
        if (s.coinsThisAttempt[ci]) continue;
        if (!overlaps(px, py, sz, sz, o)) continue;
        s.coinsThisAttempt[ci] = true;
        emit(s, 'coin', ci);
      } else if (t === T.FINISH) {
        if (px + sz < o.x) continue;
        s.won = true;
        emit(s, 'win');
        return;
      }
    }

    // A grounded cube/ball must actually have something under (or, when
    // inverted, over) it — walking off a platform edge or over a pit column
    // starts a fall instead of levitating at the old height.
    if (s.grounded && (s.mode === MODE.CUBE || s.mode === MODE.BALL)) {
      if (!hasSupport(s, ceil)) s.grounded = false;
    }

    // Fell far below the world (into a pit with no floor).
    if (s.y < -C.BLOCK * 6) { die(s, 'pit'); return; }

    s.time += dt;
    s.step++;
  }

  // Is there a surface within a small tolerance on the side gravity pulls?
  function hasSupport(s, ceil) {
    var sz = playerSize(s);
    var eps = 2.0;
    if (s.gravDir === 1) {
      if (ceil.floor !== -Infinity && s.y <= ceil.floor + eps) return true;
      var objs = queryRange(s.level, s.x - C.BLOCK, s.x + sz + C.BLOCK);
      for (var i = 0; i < objs.length; i++) {
        var o = objs[i];
        if (!isSolid(o.type)) continue;
        if (s.x < o.x + o.w && s.x + sz > o.x &&
            Math.abs(s.y - (o.y + o.h)) <= eps) return true;
      }
      return false;
    }
    if (s.y + sz >= ceil.ceil - eps) return true;
    var objs2 = queryRange(s.level, s.x - C.BLOCK, s.x + sz + C.BLOCK);
    for (var j = 0; j < objs2.length; j++) {
      var o2 = objs2[j];
      if (!isSolid(o2.type)) continue;
      if (s.x < o2.x + o2.w && s.x + sz > o2.x &&
          Math.abs((s.y + sz) - o2.y) <= eps) return true;
    }
    return false;
  }

  function clampFall(vy, g, maxFall) {
    if (vy * g < -maxFall) return -maxFall * g;
    return vy;
  }

  // The permanent floor is the ground plane unless the section removed it
  // (pits are modelled with explicit gap markers: ground exists everywhere
  // except columns listed in level.meta.pits).
  function groundCeil(s) {
    var floor = C.GROUND_Y;
    var floorIsBlock = false;
    var hasFloor = true;
    var lvl = s.level.meta;
    if (lvl.pits) {
      var col = Math.floor((s.x + playerSize(s) / 2) / C.BLOCK);
      if (lvl.pits[col]) hasFloor = false;
    }
    if (!hasFloor) floor = -Infinity;
    var ceilY = C.GROUND_Y + C.VIEW_H + C.CEIL_MARGIN;
    if (s.mode === MODE.SHIP || s.mode === MODE.WAVE || s.mode === MODE.UFO ||
        s.mode === MODE.BALL) {
      // Flying modes cap at a fixed ceiling so you cannot fly over the level.
      ceilY = C.GROUND_Y + (s.level.meta.ceiling != null
        ? s.level.meta.ceiling * C.BLOCK : C.VIEW_H);
    }
    return { floor: floor, ceil: ceilY, floorIsBlock: false, ceilIsBlock: false };
  }

  function landIfFalling(s, dir) {
    // dir: 1 landed on a floor, -1 landed on a ceiling.
    if (s.gravDir === dir) {
      s.contact = true;
      // Edge-triggered: ship/UFO/wave clear `grounded` every substep, so the
      // contact flags (not `grounded`) decide whether this is a fresh touch.
      if (!s.contactPrev) emit(s, 'land');
      if (!s.grounded) {
        s.grounded = true;
        snapRotation(s);
      }
    } else if (s.mode === MODE.BALL) {
      // Ball resting against the surface opposite to gravity counts as
      // rolling (it can flip again); the cube just slides.
      s.contact = true;
      if (!s.grounded) { s.grounded = true; snapRotation(s); }
    }
  }

  function snapRotation(s) {
    if (s.mode !== MODE.CUBE) return;
    var q = Math.PI / 2;
    s.rotation = Math.round(s.rotation / q) * q;
  }

  // Resolve player vs solid block. Returns 'die' on a fatal side hit.
  function solidResolve(s, o, prevY, sz, innerPad) {
    var g = s.gravDir;
    var topOf = o.y + o.h, botOf = o.y;

    if (g === 1) {
      // Landing on top: previous bottom edge was at/above the block top.
      if (prevY >= topOf - innerPad && s.vy <= 0) {
        s.y = topOf;
        s.vy = 0;
        landIfFalling(s, 1);
        return 'land';
      }
      // Head bonk from below.
      if (prevY + sz <= botOf + innerPad && s.vy > 0) {
        if (s.mode === MODE.SHIP || s.mode === MODE.UFO || s.mode === MODE.BALL) {
          s.y = botOf - sz;
          s.vy = 0;
          landIfFalling(s, -1);
          return 'ceil';
        }
        s.y = botOf - sz;
        s.vy = 0;
        return 'bonk';
      }
    } else {
      if (prevY + sz <= botOf + innerPad && s.vy >= 0) {
        s.y = botOf - sz;
        s.vy = 0;
        landIfFalling(s, -1);
        return 'land';
      }
      if (prevY >= topOf - innerPad && s.vy < 0) {
        if (s.mode === MODE.SHIP || s.mode === MODE.UFO || s.mode === MODE.BALL) {
          s.y = topOf;
          s.vy = 0;
          landIfFalling(s, 1);
          return 'ceil';
        }
        s.y = topOf;
        s.vy = 0;
        return 'bonk';
      }
    }
    return 'die';
  }

  function applyPortal(s, o) {
    var t = o.type, m = null;
    if (t === T.PORTAL_CUBE) m = MODE.CUBE;
    else if (t === T.PORTAL_SHIP) m = MODE.SHIP;
    else if (t === T.PORTAL_BALL) m = MODE.BALL;
    else if (t === T.PORTAL_UFO) m = MODE.UFO;
    else if (t === T.PORTAL_WAVE) m = MODE.WAVE;
    if (m !== null) {
      if (s.mode !== m) {
        s.mode = m;
        s.rotation = 0;
        // Dampen velocity through mode changes so entries are controllable.
        s.vy *= 0.4;
        emit(s, 'portal', m);
      }
      return;
    }
    if (t === T.PORTAL_GRAV_UP && s.gravDir !== -1) {
      s.gravDir = -1; s.grounded = false; s.vy *= 0.5; emit(s, 'gravity', -1);
    } else if (t === T.PORTAL_GRAV_DOWN && s.gravDir !== 1) {
      s.gravDir = 1; s.grounded = false; s.vy *= 0.5; emit(s, 'gravity', 1);
    }
  }

  function applyPad(s, o) {
    var g = s.gravDir, jv = C.CUBE.jumpVel;
    if (o.type === T.PAD_YELLOW) s.vy = jv * C.PAD_YELLOW * g;
    else if (o.type === T.PAD_PINK) s.vy = jv * C.PAD_PINK * g;
    else if (o.type === T.PAD_RED) s.vy = jv * C.PAD_RED * g;
    else if (o.type === T.PAD_BLUE) {
      s.gravDir = -g;
      s.vy = jv * 0.55 * s.gravDir;
    }
    s.grounded = false;
    emit(s, 'pad', o.type);
  }

  function applyOrb(s, o) {
    var g = s.gravDir, jv = C.CUBE.jumpVel;
    if (o.type === T.ORB_YELLOW) s.vy = jv * C.ORB_YELLOW * g;
    else if (o.type === T.ORB_PINK) s.vy = jv * C.ORB_PINK * g;
    else if (o.type === T.ORB_RED) s.vy = jv * C.ORB_RED * g;
    else if (o.type === T.ORB_BLUE) {
      s.gravDir = -g;
      s.vy = jv * C.ORB_BLUE_FALL * s.gravDir;
    } else if (o.type === T.ORB_GREEN) {
      s.gravDir = -g;
      s.vy = jv * s.gravDir;
    } else if (o.type === T.ORB_BLACK) {
      s.vy = -jv * 1.15 * g;
    }
    s.grounded = false;
    emit(s, 'orb', o.type);
  }

  function progress(s) {
    var span = s.level.lengthUnits;
    if (span <= 0) return 0;
    return Math.max(0, Math.min(1, s.x / span));
  }

  var SIM = {
    compileLevel: compileLevel,
    createState: createState,
    makeCheckpoint: makeCheckpoint,
    stepSim: stepSim,
    progress: progress,
    queryRange: queryRange,
    hazardRect: hazardRect,
    playerSize: playerSize,
    isSolid: isSolid,
    isHazard: isHazard,
    isPortal: isPortal,
    isPad: isPad,
    isOrb: isOrb,
    isSpeed: isSpeed
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SIM;
  else global.GD_SIM = SIM;
})(typeof window !== 'undefined' ? window : globalThis);
