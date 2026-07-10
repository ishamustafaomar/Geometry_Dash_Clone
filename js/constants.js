/*
 * Geometric Rush — constants.
 *
 * All physics values are expressed in "units" where one grid block is 30
 * units, matching the scale conventions commonly used by the rhythm-
 * platformer community. Time is in seconds; the simulation runs at a fixed
 * 240 Hz so results are deterministic across machines (required by the
 * Node-based completability solver in test/).
 */
(function (global) {
  'use strict';

  var C = {};

  // --- World scale -------------------------------------------------------
  C.BLOCK = 30;                 // units per grid block
  C.VIEW_W = 570;               // world units visible horizontally (19 blocks)
  C.VIEW_H = 320;               // world units visible vertically (~10.7 blocks)
  C.GROUND_Y = 0;               // world y of the ground surface (up = +y)
  C.CEIL_MARGIN = 300;          // ceiling used in ship/wave sections without walls

  // --- Timing ------------------------------------------------------------
  C.PHYS_HZ = 240;              // physics substeps per second
  C.PHYS_DT = 1 / 240;

  // --- Horizontal speeds (units/second) -----------------------------------
  // Index by speed id: 0 = slow, 1 = normal, 2 = fast, 3 = faster, 4 = fastest
  C.SPEEDS = [251.16, 311.58, 387.42, 468.0, 576.0];

  // --- Cube --------------------------------------------------------------
  C.CUBE = {
    gravity: 3449.5,            // units/s^2  (0.958199 u/frame^2 @60fps)
    jumpVel: 670.8,             // units/s    (11.180032 u/frame @60fps)
    maxFall: 936.0,             // terminal fall speed
    size: 30                    // physical hitbox, square
  };
  // Inner hitbox used for solid-vs-death tolerance (corner clips survive).
  C.INNER_FRAC = 0.34;

  // --- Ship --------------------------------------------------------------
  C.SHIP = {
    gravity: 1379.8,            // passive sink when not holding
    thrust: 2814.8,             // upward acceleration while holding
    maxUp: 480.0,
    maxDown: 480.0,
    size: 30
  };

  // --- Ball --------------------------------------------------------------
  C.BALL = {
    gravity: 2069.7,            // rolls with lower gravity than the cube
    maxFall: 780.0,
    size: 30
  };

  // --- UFO ---------------------------------------------------------------
  C.UFO = {
    gravity: 3449.5,
    jumpVel: 480.0,             // tap impulse
    maxFall: 810.0,
    size: 30
  };

  // --- Wave --------------------------------------------------------------
  // The wave travels on 45-degree diagonals at 1x; vertical speed equals the
  // current horizontal speed (doubled while "mini", not implemented).
  C.WAVE = { size: 24 };

  // --- Pads / orbs (impulses expressed as fractions of cube jumpVel) -------
  C.PAD_YELLOW = 1.37;          // strong bounce
  C.PAD_PINK   = 0.90;          // soft bounce
  C.PAD_RED    = 1.74;          // huge bounce
  C.ORB_YELLOW = 1.00;
  C.ORB_PINK   = 0.76;
  C.ORB_RED    = 1.32;
  C.ORB_BLUE_FALL = 0.42;       // initial fall speed fraction after flip

  // Buffer window: holding input as you cross an orb triggers it.
  C.ORB_RADIUS = 34;            // activation radius in units

  // --- Hazard hitboxes (fractions of a block) ------------------------------
  C.SPIKE_HIT_W = 0.32;         // centred slab inside the spike triangle
  C.SPIKE_HIT_H = 0.44;
  C.SAW_HIT_R = 0.66;           // circle, fraction of visual radius

  // --- Player/camera -----------------------------------------------------
  C.PLAYER_SCREEN_X = 0.28;     // player sits 28% from the left edge
  C.CAM_LERP = 8.0;             // vertical follow strength (1/s)
  C.RESPAWN_DELAY = 1.0;        // seconds after death before a new attempt

  // --- Object type ids ----------------------------------------------------
  C.T = {
    BLOCK: 1,        // solid square
    HALF: 2,         // half-height solid slab (top half of cell)
    SPIKE: 3,        // upward spike
    SPIKE_DOWN: 4,   // ceiling spike
    SMALL_SPIKE: 5,  // half-height spike
    SAW: 6,          // rotating saw blade (circle hazard)
    PAD_YELLOW: 10,
    PAD_PINK: 11,
    PAD_BLUE: 12,    // gravity-flip pad
    PAD_RED: 13,
    ORB_YELLOW: 20,
    ORB_PINK: 21,
    ORB_RED: 22,
    ORB_BLUE: 23,    // gravity-flip orb
    ORB_GREEN: 24,   // flip + jump
    ORB_BLACK: 25,   // slam downward
    PORTAL_CUBE: 30,
    PORTAL_SHIP: 31,
    PORTAL_BALL: 32,
    PORTAL_UFO: 33,
    PORTAL_WAVE: 34,
    PORTAL_GRAV_UP: 35,   // flip gravity to inverted
    PORTAL_GRAV_DOWN: 36, // restore normal gravity
    SPEED_05: 40,
    SPEED_1: 41,
    SPEED_2: 42,
    SPEED_3: 43,
    SPEED_4: 44,
    COIN: 50,
    FINISH: 60,
    DECO_SPIKES: 70, // decorative silhouette spikes (no hitbox)
    CHAIN: 71,       // decorative chain/pillar
    ARROW: 72        // decorative guidance arrow
  };

  C.MODE = { CUBE: 0, SHIP: 1, BALL: 2, UFO: 3, WAVE: 4 };

  if (typeof module !== 'undefined' && module.exports) module.exports = C;
  else global.GD_CONST = C;
})(typeof window !== 'undefined' ? window : globalThis);
