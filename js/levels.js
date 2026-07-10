/*
 * Geometric Rush — level data.
 *
 * Three original levels, authored with small pattern helpers. Positions are
 * in blocks (1 block = 30 units); y = 0 is the ground surface. Every level
 * is proven completable by test/solve.js — if you edit a layout, re-run it.
 *
 * Design numbers used throughout (at 1x speed, cube):
 *   jump arc ~4.0 blocks long, ~2.2 blocks high
 *   yellow pad flight ~5.5 blocks, red pad ~7.0 blocks (from trigger point,
 *   which is ~1 block before the pad cell because the hitboxes touch early)
 */
(function (global) {
  'use strict';

  var C = (typeof module !== 'undefined' && module.exports)
    ? require('./constants.js')
    : global.GD_CONST;
  var T = C.T, MODE = C.MODE;

  // ---------------------------------------------------------------------
  // Builder
  // ---------------------------------------------------------------------
  function Builder(meta) {
    this.meta = meta;
    meta.objects = [];
    meta.pits = {};
    meta.zones = meta.zones || [];
  }
  Builder.prototype.add = function (t, x, y, w, h, rot) {
    this.meta.objects.push({ t: t, x: x, y: y, w: w || 1, h: h || 1, rot: rot || 0 });
    return this;
  };
  Builder.prototype.blk = function (x, y, w, h) { return this.add(T.BLOCK, x, y, w, h); };
  Builder.prototype.half = function (x, y, w) { return this.add(T.HALF, x, y, w, 1); };
  Builder.prototype.spike = function (x, n, y) {
    for (var i = 0; i < (n || 1); i++) this.add(T.SPIKE, x + i, y || 0, 1, 1);
    return this;
  };
  Builder.prototype.spikeDown = function (x, y, n) {
    for (var i = 0; i < (n || 1); i++) this.add(T.SPIKE_DOWN, x + i, y, 1, 1);
    return this;
  };
  Builder.prototype.small = function (x, n, y) {
    for (var i = 0; i < (n || 1); i++) this.add(T.SMALL_SPIKE, x + i, y || 0, 1, 1);
    return this;
  };
  Builder.prototype.saw = function (x, y, d) { return this.add(T.SAW, x, y, d || 2, d || 2); };
  Builder.prototype.pad = function (t, x, y) { return this.add(t, x, y, 1, 0.4); };
  Builder.prototype.orb = function (t, x, y) { return this.add(t, x, y, 1, 1); };
  // Portal on the expected (ground-level) path.
  Builder.prototype.portal = function (t, x, y, h) { return this.add(t, x, y, 1, h || 4); };
  // Full-height portal gate: guarantees a flying player cannot miss it.
  Builder.prototype.gate = function (t, x) { return this.add(t, x, 0, 1, 11); };
  Builder.prototype.speed = function (id, x, y) {
    return this.add(T.SPEED_05 + id, x, y || 0, 1, 2);
  };
  Builder.prototype.coin = function (x, y, idx) { return this.add(T.COIN, x, y, 1, 1, idx); };
  Builder.prototype.finish = function (x) { return this.add(T.FINISH, x, 0, 1, 14); };
  Builder.prototype.pit = function (x, len) {
    for (var i = 0; i < len; i++) this.meta.pits[x + i] = true;
    return this;
  };
  Builder.prototype.zone = function (x, bg, accent) {
    this.meta.zones.push({ x: x * C.BLOCK, bg: bg, accent: accent });
    return this;
  };
  Builder.prototype.deco = function (x, w) { return this.add(T.DECO_SPIKES, x, 0, w || 4, 1); };
  Builder.prototype.chain = function (x, y, h) { return this.add(T.CHAIN, x, y, 1, h || 3); };
  Builder.prototype.arrow = function (x, y, up) { return this.add(T.ARROW, x, y, 1, 1, up ? 1 : 0); };

  // ---------------------------------------------------------------------
  // Patterns (each returns the x where the pattern ends)
  // ---------------------------------------------------------------------

  function singles(B, x, count, spacing) {
    for (var i = 0; i < count; i++) B.spike(x + i * spacing, 1);
    return x + count * spacing;
  }

  function doubles(B, x, count, spacing) {
    for (var i = 0; i < count; i++) B.spike(x + i * spacing, 2);
    return x + count * spacing;
  }

  // Floating platforms over ground spikes; hop platform to platform.
  function platformHop(B, x, hops, gap, platLen) {
    var cx = x;
    for (var i = 0; i < hops; i++) {
      B.blk(cx, 0, platLen, 1);
      if (i < hops - 1) B.spike(cx + platLen, gap, 0);
      cx += platLen + gap;
    }
    return cx;
  }

  function stairs(B, x, steps, runLen) {
    for (var i = 1; i <= steps; i++) {
      B.blk(x, 0, runLen, i);
      x += runLen;
    }
    B.blk(x, 0, runLen + 2, steps);
    return x + runLen + 2;
  }

  // Orb hops: pits crossed by tapping a yellow orb mid-flight.
  function orbHop(B, x, count, pitW, orbY) {
    var cx = x;
    for (var i = 0; i < count; i++) {
      B.pit(cx + 1, pitW);
      B.orb(T.ORB_YELLOW, cx + 1 + pitW / 2 - 0.5, orbY);
      cx += 1 + pitW + 2;
    }
    return cx;
  }

  // Ship corridor along a sine wave. Floor height 0 means "open to the
  // ground", so the corridor entrance never presents a wall face.
  function shipCorridor(B, x, len, gap, base, amp, period, ceilTop) {
    ceilTop = ceilTop || 13;
    for (var i = 0; i < len; i++) {
      var t = (i / period) * Math.PI * 2 - Math.PI / 2;
      var floorTop = Math.max(0, Math.round(base + amp * Math.sin(t)));
      var ceilBot = floorTop + gap;
      if (floorTop > 0) B.blk(x + i, 0, 1, floorTop);
      B.blk(x + i, ceilBot, 1, Math.max(1, ceilTop - ceilBot));
    }
    return x + len;
  }

  // Ship slalom: open floor (the ground), ceiling overhead, alternating
  // pillars growing from the ground and hanging from the ceiling.
  function shipSlalom(B, x, len, ceilBot, every, pillarH, ceilTop) {
    ceilTop = ceilTop || 13;
    B.blk(x, ceilBot, len, Math.max(1, ceilTop - ceilBot));
    var alt = false;
    for (var i = every; i < len - 2; i += every) {
      if (alt) B.blk(x + i, ceilBot - pillarH, 1, pillarH);
      else B.blk(x + i, 0, 1, pillarH);
      alt = !alt;
    }
    return x + len;
  }

  // Ball corridor: ground floor, block ceiling, alternating spikes that
  // force gravity flips.
  function ballCorridor(B, x, len, gap, every, ceilTop) {
    ceilTop = ceilTop || 13;
    var ceilBot = gap;
    B.blk(x, ceilBot, len, Math.max(1, ceilTop - ceilBot));
    var alt = false;
    for (var i = every; i < len - 3; i += every) {
      if (alt) B.spikeDown(x + i, ceilBot - 1, 2);
      else B.spike(x + i, 2, 0);
      alt = !alt;
    }
    return x + len;
  }

  // UFO cavern: ceiling overhead, ground spike runs to hop across.
  function ufoRun(B, x, len, ceilBot, every, spikes, ceilTop) {
    ceilTop = ceilTop || 13;
    B.blk(x, ceilBot, len, Math.max(1, ceilTop - ceilBot));
    for (var i = every; i < len - 3; i += every) {
      B.spike(x + i, spikes, 0);
    }
    return x + len;
  }

  // Wave corridor: triangle-wave tunnel. Slope must stay below 1.0 or the
  // wave physically cannot follow it (the wave moves on 45-degree lines).
  function waveZig(B, x, len, gap, base, amp, period, ceilTop) {
    ceilTop = ceilTop || 13;
    for (var i = 0; i < len; i++) {
      var ph = (i % period) / period;
      var tri = ph < 0.5 ? ph * 2 : 2 - ph * 2; // 0..1..0 triangle
      var floorTop = Math.max(0, Math.round(base + amp * (tri - 0.5) * 2));
      var ceilBot = floorTop + gap;
      if (floorTop > 0) B.blk(x + i, 0, 1, floorTop);
      B.blk(x + i, ceilBot, 1, Math.max(1, ceilTop - ceilBot));
    }
    return x + len;
  }

  // ---------------------------------------------------------------------
  // LEVEL 1 — "Prism Runner" (Easy)
  // ---------------------------------------------------------------------
  function level1() {
    var meta = {
      id: 'prism-runner', name: 'Prism Runner', difficulty: 'Easy', stars: 2,
      bpm: 124.63, musicId: 0,
      startMode: MODE.CUBE, startSpeed: 1, ceiling: 11
    };
    var B = new Builder(meta);
    B.zone(-20, '#1b2a6b', '#39a0ff');

    // Intro: pure rhythm singles.
    B.arrow(18, 1, true);
    var x = singles(B, 22, 4, 10);      // one spike every other beat
    x = singles(B, x + 4, 4, 5);        // every beat

    // Doubles with rests.
    x = doubles(B, x + 6, 3, 10);
    B.deco(x, 6);

    // Platform hops over spikes.
    B.zone(130, '#232a7a', '#5ad2ff');
    B.coin(136, 2.8, 0);                // coin #1: hop high off the first platform
    x = platformHop(B, 132, 4, 2, 5);
    x = singles(B, x + 4, 3, 5);

    // Yellow pads over small pits.
    var cx = x + 5;
    for (var i = 0; i < 3; i++) {
      B.pad(T.PAD_YELLOW, cx, 0);
      B.pit(cx + 1, 3);
      cx += 8;
    }
    x = cx + 2;

    // Ship section 1 (gentle sine corridor).
    B.zone(x + 2, '#123c63', '#37e6c8');
    B.arrow(x + 1, 1, false);
    B.portal(T.PORTAL_SHIP, x + 4, 0, 4);
    x = shipCorridor(B, x + 8, 70, 6, 1.5, 1.5, 24, 13);
    B.gate(T.PORTAL_CUBE, x + 1);
    x += 4;

    // Orb hops.
    B.zone(x + 2, '#2a2f8f', '#7f7bff');
    x = orbHop(B, x + 4, 3, 5, 1.6);
    x = singles(B, x + 4, 4, 5);

    // Stairs and descent.
    x = stairs(B, x + 6, 2, 4);
    B.spike(x + 2, 1, 0);
    x += 8;

    // Ship section 2: pillar slalom + coin detour up top.
    B.zone(x, '#0f4a5e', '#3ce0ff');
    B.portal(T.PORTAL_SHIP, x + 2, 0, 4);
    B.coin(x + 22, 6.8, 1);             // coin #2: fly high between pillars
    x = shipSlalom(B, x + 6, 60, 9, 12, 4, 13);
    B.gate(T.PORTAL_CUBE, x + 1);
    x += 5;

    // Rhythm run to the classic triple.
    B.zone(x, '#3a2380', '#c86bff');
    x = singles(B, x + 4, 3, 5);
    x = doubles(B, x + 5, 2, 9);
    B.blk(x + 4, 0, 4, 1);
    B.spike(x + 8, 1, 1);
    x += 12;
    B.spike(x + 4, 3, 0);               // the triple spike
    B.coin(x + 5, 2.6, 2);              // coin #3: ride the arc over the triple
    x += 10;

    // Victory lap.
    x = singles(B, x, 2, 6);
    B.deco(x + 4, 8);
    B.chain(x + 6, 1, 4);
    B.chain(x + 12, 1, 4);
    B.finish(x + 18);
    return meta;
  }

  // ---------------------------------------------------------------------
  // LEVEL 2 — "Neon Circuit" (Medium)
  // ---------------------------------------------------------------------
  function level2() {
    var meta = {
      id: 'neon-circuit', name: 'Neon Circuit', difficulty: 'Medium', stars: 5,
      bpm: 140, musicId: 1,
      startMode: MODE.CUBE, startSpeed: 1, ceiling: 11
    };
    var B = new Builder(meta);
    B.zone(-20, '#3d1160', '#ff4fd8');

    // Cube: tighter singles + smalls.
    var x = singles(B, 20, 4, 8);
    x = doubles(B, x + 4, 3, 8);
    B.small(x + 3, 2);
    x += 8;
    x = platformHop(B, x + 3, 4, 3, 4);
    B.spike(x + 3, 2, 0);
    x += 8;

    // Ball corridor.
    B.zone(x, '#511042', '#ff7847');
    B.arrow(x + 1, 1, false);
    B.portal(T.PORTAL_BALL, x + 3, 0, 4);
    x = ballCorridor(B, x + 6, 64, 5, 8, 13);
    B.gate(T.PORTAL_CUBE, x + 1);
    x += 5;

    // Cube at 2x: wider spacing, bigger jumps.
    B.zone(x, '#6b1430', '#ff5a5a');
    B.speed(2, x + 2);
    x = singles(B, x + 8, 4, 9);
    x = doubles(B, x + 6, 3, 11);
    B.pit(x + 3, 4);
    B.orb(T.ORB_YELLOW, x + 4.5, 1.6);
    x += 10;
    x = platformHop(B, x + 2, 4, 3, 5);
    B.speed(1, x + 2);
    x += 6;

    // Ship over open ground with saws under a ceiling.
    B.zone(x, '#123c63', '#48b7ff');
    B.portal(T.PORTAL_SHIP, x + 2, 0, 4);
    var sx = x + 6;
    B.blk(sx, 9, 70, 4);
    B.saw(sx + 12, 3.0, 2);
    B.saw(sx + 26, 5.5, 2);
    B.saw(sx + 40, 2.5, 2);
    B.saw(sx + 54, 5.5, 2);
    B.coin(sx + 40, 7.4, 0);            // coin #1: high line over the third saw
    x = sx + 70;
    B.gate(T.PORTAL_CUBE, x + 1);
    x += 5;

    // Pad launch onto a ledge, then back down.
    B.zone(x, '#43146b', '#b56bff');
    B.pad(T.PAD_YELLOW, x + 4, 0);
    B.pit(x + 5, 3);
    B.blk(x + 7, 0, 5, 2);              // 2-high landing ledge (covers pit tail)
    B.spike(x + 11, 1, 2);              // hop off the ledge end
    x += 16;
    x = singles(B, x, 3, 7);

    // Ball with gravity portals: ride the ceiling strip.
    B.zone(x, '#0d4f46', '#2fe8a8');
    B.portal(T.PORTAL_BALL, x + 2, 0, 4);
    x = ballCorridor(B, x + 5, 40, 5, 7, 13);
    B.portal(T.PORTAL_GRAV_UP, x + 1, 0, 3);
    B.blk(x, 6, 34, 7);                 // low ceiling to roll along
    B.spike(x + 8, 2, 0);
    B.spikeDown(x + 16, 5, 2);
    B.gate(T.PORTAL_GRAV_DOWN, x + 28); // normalise gravity wherever you are
    x += 34;
    B.gate(T.PORTAL_CUBE, x);
    x += 4;

    // Finale: rhythm gauntlet.
    B.zone(x, '#5e1268', '#ff6bf0');
    B.coin(x + 6, 1.9, 1);              // coin #2: on the arc over the doubles
    x = doubles(B, x + 4, 3, 8);
    B.spike(x + 3, 3, 0);               // a triple
    x += 8;
    x = platformHop(B, x + 2, 3, 3, 4);
    B.small(x + 3, 3);
    x += 9;
    B.pad(T.PAD_RED, x, 0);
    B.pit(x + 1, 4);
    B.coin(x + 2.6, 6.4, 2);            // coin #3: top of the red-pad arc
    x += 8;
    x = singles(B, x + 2, 2, 6);
    B.deco(x + 3, 8);
    B.finish(x + 14);
    return meta;
  }

  // ---------------------------------------------------------------------
  // LEVEL 3 — "Hyper Drift" (Hard)
  // ---------------------------------------------------------------------
  function level3() {
    var meta = {
      id: 'hyper-drift', name: 'Hyper Drift', difficulty: 'Hard', stars: 8,
      bpm: 150, musicId: 2,
      startMode: MODE.CUBE, startSpeed: 1, ceiling: 11
    };
    var B = new Builder(meta);
    B.zone(-20, '#4d0f16', '#ff4242');

    // Cube: quick rhythm with smalls mixed in.
    var x = singles(B, 18, 4, 6);
    B.small(x + 2, 2);
    x = doubles(B, x + 7, 3, 8);
    B.spike(x + 4, 3, 0);
    x += 10;
    x = platformHop(B, x + 2, 5, 3, 4);
    x += 4;

    // Wave 1 (1x).
    B.zone(x, '#101b4d', '#5a7bff');
    B.arrow(x + 1, 1, false);
    B.portal(T.PORTAL_WAVE, x + 3, 0, 4);
    x = waveZig(B, x + 7, 64, 4, 2, 2.5, 16, 13);
    B.gate(T.PORTAL_CUBE, x + 1);
    x += 5;

    // Cube breather, then ship at 2x with a saw slalom.
    x = singles(B, x + 2, 2, 6);
    B.zone(x, '#0b3d5e', '#31d3ff');
    B.portal(T.PORTAL_SHIP, x + 2, 0, 4);
    B.speed(2, x + 5, 0);
    var sx = x + 8;
    B.blk(sx, 9, 88, 4);
    B.saw(sx + 12, 5.0, 2);
    B.saw(sx + 24, 2.0, 2);
    B.saw(sx + 36, 5.5, 2);
    B.saw(sx + 48, 2.5, 2);
    B.saw(sx + 60, 5.0, 2);
    B.saw(sx + 72, 2.0, 2);
    B.coin(sx + 48, 7.4, 0);            // coin #1
    x = sx + 88;
    B.speed(1, x + 1, 0);
    B.gate(T.PORTAL_UFO, x + 4);
    x += 8;

    // UFO cavern.
    B.zone(x, '#3f1d59', '#c05aff');
    x = ufoRun(B, x, 70, 7, 9, 3, 13);
    B.gate(T.PORTAL_BALL, x + 1);
    x += 5;

    // Ball with self-serve gravity flips: dodge floor/ceiling hazards.
    B.zone(x, '#59103d', '#ff53a5');
    B.blk(x, 5, 56, 8);                 // ceiling strip
    B.spike(x + 8, 2, 0);
    B.spikeDown(x + 16, 4, 2);
    B.saw(x + 26, 0.2, 1.6);            // ground saw: be on the ceiling here
    B.spike(x + 36, 2, 0);
    B.spikeDown(x + 44, 4, 2);
    x += 56;
    B.gate(T.PORTAL_GRAV_DOWN, x + 1);
    B.gate(T.PORTAL_WAVE, x + 3);
    x += 7;

    // Wave 2: tighter.
    B.zone(x, '#0f2440', '#3fa0ff');
    x = waveZig(B, x, 56, 3, 2, 3, 14, 13);
    B.gate(T.PORTAL_CUBE, x + 1);
    x += 5;

    // 3x cube finale.
    B.zone(x, '#651111', '#ffb13f');
    B.speed(3, x + 2, 0);
    x = singles(B, x + 10, 4, 11);
    x = doubles(B, x + 8, 3, 13);
    B.pit(x + 4, 5);
    B.orb(T.ORB_YELLOW, x + 6, 1.8);
    x += 13;
    B.coin(x + 2, 2.6, 1);              // coin #2: over the last doubles
    B.spike(x + 4, 3, 0);
    x += 9;
    B.pad(T.PAD_RED, x, 0);
    B.pit(x + 1, 7);
    B.coin(x + 5.3, 6.4, 2);            // coin #3: top of the final launch
    x += 11;
    x = singles(B, x + 2, 2, 8);
    B.deco(x + 4, 10);
    B.finish(x + 16);
    return meta;
  }

  var LEVELS = [level1(), level2(), level3()];

  if (typeof module !== 'undefined' && module.exports) module.exports = LEVELS;
  else global.GD_LEVELS = LEVELS;
})(typeof window !== 'undefined' ? window : globalThis);
