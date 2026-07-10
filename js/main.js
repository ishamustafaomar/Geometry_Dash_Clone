/*
 * Geometric Rush — game shell: state machine, input, camera, HUD, menus,
 * persistence, and the fixed-timestep loop that drives the deterministic sim.
 */
(function (global) {
  'use strict';

  var C = global.GD_CONST, SIM = global.GD_SIM, R = global.GD_RENDER,
    A = global.GD_AUDIO, LEVELS = global.GD_LEVELS,
    SOLUTIONS = global.GD_SOLUTIONS || [];
  var MODE = C.MODE;

  // ------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------
  var SAVE_KEY = 'geo-rush-save-v1';
  var save = { levels: {}, settings: { music: true, sfx: true, face: 0,
    col1: '#52ff7a', col2: '#1b2a6b' } };
  try {
    var raw = global.localStorage && localStorage.getItem(SAVE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.levels) {
        save.levels = parsed.levels || {};
        save.settings = Object.assign(save.settings, parsed.settings || {});
        save.customLevel = parsed.customLevel;
      }
    }
  } catch (e) { /* fresh save */ }

  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
    catch (e) { /* storage unavailable */ }
  }

  function levelSave(id) {
    if (!save.levels[id]) {
      save.levels[id] = { best: 0, coins: [false, false, false],
        attempts: 0, completed: false };
    }
    return save.levels[id];
  }

  A.setEnabled('music', save.settings.music);
  A.setEnabled('sfx', save.settings.sfx);

  function icon() {
    return { col1: save.settings.col1, col2: save.settings.col2,
      face: save.settings.face };
  }

  // ------------------------------------------------------------------
  // App + game state
  // ------------------------------------------------------------------
  var app = { screen: 'menu', levelIdx: 0, buttons: [], hover: null,
    mouse: { x: 0, y: 0 } };

  var game = null;    // active run
  var attract = null; // menu background replay

  var inputHeld = false;
  var lastFrame = 0;
  var acc = 0;
  var timeMs = 0;

  var SWATCHES = ['#52ff7a', '#41e0b6', '#39a0ff', '#5a7bff', '#c05aff',
    '#ff6bd6', '#ff5a5a', '#ff9d3f', '#ffd94a', '#f4f7ff', '#94a3c0',
    '#1b2a6b'];

  // ------------------------------------------------------------------
  // Game lifecycle
  // ------------------------------------------------------------------
  function startLevel(idx, opts) {
    opts = opts || {};
    var meta = opts.custom ? opts.custom : LEVELS[idx];
    game = {
      levelIdx: idx,
      custom: !!opts.custom,
      compiled: SIM.compileLevel(meta),
      state: null,
      attempts: 0,
      practice: false,
      checkpoints: [],
      respawnTimer: 0,
      winTimer: 0,
      newBest: false,
      wonStats: null,
      paused: false,
      trail: [],
      camY: -58,
      camSnap: true
    };
    app.screen = 'game';
    startAttempt();
  }

  function startAttempt() {
    var g = game;
    g.attempts++;
    if (!g.custom) levelSave(g.compiled.meta.id).attempts++;
    var cp = g.practice && g.checkpoints.length
      ? g.checkpoints[g.checkpoints.length - 1] : null;
    g.state = SIM.createState(g.compiled, cp ? { checkpoint: cp } : {});
    g.respawnTimer = 0;
    g.winTimer = 0;
    g.trail.length = 0;
    g.camSnap = true;
    R.fx.clear();
    if (!cp) A.playTrack(g.compiled.meta.musicId);
    persist();
  }

  function exitToMenu() {
    game = null;
    app.screen = 'menu';
    A.playTrack(A.MENU_TRACK);
    startAttract();
  }

  // ------------------------------------------------------------------
  // Attract mode (menu background gameplay from solver replays)
  // ------------------------------------------------------------------
  function startAttract() {
    if (!SOLUTIONS.length) { attract = null; return; }
    var idx = (attract ? attract.levelIdx + 1 : 0) % LEVELS.length;
    var sol = null;
    for (var i = 0; i < SOLUTIONS.length; i++) {
      if (SOLUTIONS[i].levelId === LEVELS[idx].id) sol = SOLUTIONS[i];
    }
    attract = {
      levelIdx: idx,
      compiled: SIM.compileLevel(LEVELS[idx]),
      state: null,
      sol: sol, ti: 0, input: false, step: 0,
      camY: -58
    };
    attract.state = SIM.createState(attract.compiled);
  }

  function stepAttract(substeps) {
    if (!attract) return;
    var at = attract;
    for (var i = 0; i < substeps; i++) {
      if (!at.sol) break;
      var tick = Math.floor(at.step / at.sol.tickSubsteps);
      while (at.ti < at.sol.toggles.length &&
             at.sol.toggles[at.ti][0] <= tick) {
        at.input = !!at.sol.toggles[at.ti][1];
        at.ti++;
      }
      SIM.stepSim(at.state, at.input);
      at.state.events.length = 0;
      at.step++;
      if (at.state.dead || at.state.won) { startAttract(); return; }
    }
  }

  // ------------------------------------------------------------------
  // Input
  // ------------------------------------------------------------------
  function onDown(x, y, isTouch) {
    A.unlock();
    app.mouse.x = x; app.mouse.y = y;
    if (app.screen === 'game' && game && !game.paused && !game.wonStats) {
      // HUD pause button?
      if (hitButtons(x, y)) return;
      inputHeld = true;
      return;
    }
    if (!hitButtons(x, y) && app.screen === 'editor' && global.GD_EDITOR) {
      global.GD_EDITOR.onDown(x, y);
    }
  }
  function onUp(x, y) {
    inputHeld = false;
    if (app.screen === 'editor' && global.GD_EDITOR) global.GD_EDITOR.onUp(x, y);
  }
  function onMove(x, y) {
    app.mouse.x = x; app.mouse.y = y;
    app.hover = null;
    for (var i = 0; i < app.buttons.length; i++) {
      var b = app.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        app.hover = b;
      }
    }
    if (app.screen === 'editor' && global.GD_EDITOR) global.GD_EDITOR.onMove(x, y);
  }

  function hitButtons(x, y) {
    for (var i = app.buttons.length - 1; i >= 0; i--) {
      var b = app.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        A.sfxClick();
        b.cb();
        return true;
      }
    }
    return false;
  }

  function canvasPos(e) {
    var rect = canvas.getBoundingClientRect();
    var cx = (e.touches && e.touches.length ? e.touches[0].clientX : e.clientX);
    var cy = (e.touches && e.touches.length ? e.touches[0].clientY : e.clientY);
    return {
      x: (cx - rect.left) / rect.width * R.W(),
      y: (cy - rect.top) / rect.height * R.H()
    };
  }

  function bindInput(cv) {
    cv.addEventListener('mousedown', function (e) {
      var p = canvasPos(e); onDown(p.x, p.y, false); e.preventDefault();
    });
    global.addEventListener('mouseup', function (e) {
      var p = canvasPos(e); onUp(p.x, p.y);
    });
    cv.addEventListener('mousemove', function (e) {
      var p = canvasPos(e); onMove(p.x, p.y);
    });
    cv.addEventListener('touchstart', function (e) {
      var p = canvasPos(e); onDown(p.x, p.y, true); e.preventDefault();
    }, { passive: false });
    global.addEventListener('touchend', function (e) {
      onUp(app.mouse.x, app.mouse.y); e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchmove', function (e) {
      var p = canvasPos(e); onMove(p.x, p.y); e.preventDefault();
    }, { passive: false });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    global.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      A.unlock();
      var k = e.code;
      if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW') {
        if (app.screen === 'game') inputHeld = true;
        e.preventDefault();
      } else if (k === 'Escape' || k === 'KeyP') {
        if (app.screen === 'game' && game && !game.wonStats) togglePause();
        else if (app.screen === 'editor') { /* editor handles */ }
        else if (app.screen !== 'menu') { exitToMenu(); }
      } else if (k === 'KeyZ') {
        if (app.screen === 'game' && game && game.practice && game.state &&
            !game.state.dead && !game.state.won && game.state.grounded) {
          game.checkpoints.push(SIM.makeCheckpoint(game.state));
          R.fx.checkpoint(game.state.x + 15, game.state.y + 15);
          A.sfxCheckpoint();
        }
      } else if (k === 'KeyX') {
        if (app.screen === 'game' && game && game.practice) {
          game.checkpoints.pop();
        }
      } else if (app.screen === 'editor' && global.GD_EDITOR) {
        global.GD_EDITOR.onKey(k);
      }
    });
    global.addEventListener('keyup', function (e) {
      var k = e.code;
      if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW') inputHeld = false;
    });
    global.addEventListener('blur', function () {
      inputHeld = false;
      if (app.screen === 'game' && game && !game.paused && !game.wonStats) {
        togglePause();
      }
    });
    global.addEventListener('resize', function () { R.resize(); });
  }

  function togglePause() {
    if (!game) return;
    game.paused = !game.paused;
    if (game.paused) A.stopMusic();
    else if (!game.state.dead) A.playTrack(game.compiled.meta.musicId);
  }

  // ------------------------------------------------------------------
  // Game update
  // ------------------------------------------------------------------
  function updateGame(dt) {
    var g = game;
    if (!g || g.paused) return;

    if (g.wonStats) return; // frozen on win screen

    if (g.state.dead) {
      g.respawnTimer -= dt;
      if (g.respawnTimer <= 0) startAttempt();
      return;
    }

    acc += dt;
    var maxSub = 12; // don't spiral after a hitch
    var subs = 0;
    while (acc >= C.PHYS_DT && subs < maxSub * 4) {
      SIM.stepSim(g.state, inputHeld);
      drainEvents(g);
      acc -= C.PHYS_DT;
      subs++;
      if (g.state.dead || g.state.won) { acc = 0; break; }
    }

    // Trail
    var st = g.state;
    if (!st.dead) {
      if (st.mode === MODE.WAVE) {
        g.trail.push([st.x + 15, st.y + SIM.playerSize(st) / 2]);
        if (g.trail.length > 90) g.trail.shift();
      } else if (g.trail.length) {
        g.trail.shift();
      }
      if (st.mode === MODE.SHIP && inputHeld && (st.step % 4 === 0)) {
        R.fx.trail(st.x - 8, st.y + 8, '#ffd94a');
      }
    }
  }

  function drainEvents(g) {
    var st = g.state;
    for (var i = 0; i < st.events.length; i++) {
      var ev = st.events[i];
      if (ev.name === 'death') {
        A.stopMusic();
        A.sfxDeath();
        R.fx.explosion(ev.x + 15, ev.y + 15, save.settings.col1);
        g.respawnTimer = g.practice ? 0.45 : C.RESPAWN_DELAY;
        if (!g.custom) {
          var ls = levelSave(g.compiled.meta.id);
          ls.best = Math.max(ls.best, Math.floor(SIM.progress(st) * 100));
          persist();
        }
      } else if (ev.name === 'land') {
        R.fx.landDust(st.x + 4, st.y + (st.gravDir === 1 ? 1 : 29),
          st.gravDir);
      } else if (ev.name === 'coin') {
        A.sfxCoin();
        R.fx.coin(ev.x + 15, ev.y + 15);
      } else if (ev.name === 'pad' || ev.name === 'orb') {
        R.fx.landDust(st.x + 10, st.y + 15, st.gravDir);
      } else if (ev.name === 'win') {
        onWin(g);
      }
    }
    st.events.length = 0;
  }

  function onWin(g) {
    A.stopMusic();
    A.sfxWin();
    var st = g.state;
    for (var i = 0; i < 7; i++) {
      R.fx.firework(st.x - 60 + i * 25, st.y + 40 + (i % 3) * 40,
        ['#52ff7a', '#ffd94a', '#ff6bd6', '#39a0ff'][i % 4]);
    }
    var coins = st.coinsThisAttempt.slice();
    if (!g.custom) {
      var ls = levelSave(g.compiled.meta.id);
      ls.best = 100;
      var newCoins = 0;
      if (!g.practice) {
        for (var c = 0; c < 3; c++) {
          if (coins[c] && !ls.coins[c]) { ls.coins[c] = true; newCoins++; }
        }
        ls.completed = true;
      }
      persist();
      g.wonStats = {
        attempts: g.attempts, coins: coins, newCoins: newCoins,
        practice: g.practice
      };
    } else {
      g.wonStats = { attempts: g.attempts, coins: coins, newCoins: 0,
        practice: g.practice, custom: true };
    }
  }

  // ------------------------------------------------------------------
  // Camera
  // ------------------------------------------------------------------
  function updateCamera(dt, st, holder) {
    var targetX = st.x - C.VIEW_W * C.PLAYER_SCREEN_X;
    var y = holder.camY;
    var py = st.y;
    var lo = y + 78, hi = y + C.VIEW_H - 120;
    var target = y;
    if (py < lo) target = py - 78;
    if (py > hi) target = py - (C.VIEW_H - 120);
    target = Math.max(-70, target);
    if (holder.camSnap) { y = target; holder.camSnap = false; }
    else y += (target - y) * Math.min(1, C.CAM_LERP * dt);
    holder.camY = y;
    R.setCam(targetX, y);
  }

  // ------------------------------------------------------------------
  // Buttons / UI plumbing
  // ------------------------------------------------------------------
  function button(x, y, w, h, label, cb, opts) {
    opts = opts || {};
    app.buttons.push({ x: x, y: y, w: w, h: h, label: label, cb: cb,
      color: opts.color, size: opts.size, icon: opts.icon });
    var ctx = R.ctx();
    var hovered = app.hover && app.hover.x === x && app.hover.y === y &&
      app.hover.label === label;
    ctx.save();
    ctx.globalAlpha = opts.alpha != null ? opts.alpha : 1;
    ctx.shadowColor = opts.color || '#39a0ff';
    ctx.shadowBlur = hovered ? 18 : 8;
    ctx.fillStyle = hovered ? 'rgba(40,48,86,0.95)' : 'rgba(18,22,44,0.92)';
    R.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = opts.color || '#39a0ff';
    ctx.lineWidth = 2.5;
    R.roundRect(x, y, w, h, 12);
    ctx.stroke();
    ctx.restore();
    if (label) {
      R.outlinedText(label, x + w / 2, y + h / 2 + 1, opts.size || 22,
        opts.textColor || '#ffffff');
    }
  }

  // ------------------------------------------------------------------
  // Screens
  // ------------------------------------------------------------------
  function drawMenu() {
    // Attract gameplay behind the panel.
    if (attract) {
      updateCamera(1 / 60, attract.state, attract);
      R.drawBackground(attract.compiled.meta, timeMs, A.beatPhase());
      R.drawGround(attract.compiled.meta, timeMs, A.beatPhase());
      R.drawObjects(attract.compiled, attract.state, timeMs, A.beatPhase(),
        null);
      R.drawPlayer(attract.state, icon(), timeMs, attract.input);
      var ctx = R.ctx();
      ctx.fillStyle = 'rgba(8,10,26,0.55)';
      ctx.fillRect(0, 0, R.W(), R.H());
    } else {
      var meta = LEVELS[0];
      R.drawBackground(meta, timeMs, 0);
      R.drawGround(meta, timeMs, 0);
    }

    var W = R.W(), H = R.H();
    var bob = Math.sin(timeMs * 0.0016) * 6;
    R.outlinedText('GEOMETRIC', W / 2, H * 0.2 + bob, 84, '#52ff7a');
    R.outlinedText('RUSH', W / 2, H * 0.2 + 86 + bob, 84, '#ffd94a');
    R.outlinedText('an original rhythm platformer', W / 2, H * 0.2 + 150 + bob,
      19, '#c9d4ff');

    button(W / 2 - 150, H * 0.52, 300, 74, 'PLAY', function () {
      app.screen = 'select';
    }, { color: '#52ff7a', size: 34 });
    button(W / 2 - 150, H * 0.52 + 96, 300, 56, 'ICON KIT', function () {
      app.screen = 'icons';
    }, { color: '#ffd94a' });
    button(W / 2 - 150, H * 0.52 + 172, 300, 56, 'LEVEL EDITOR', function () {
      app.screen = 'editor';
      global.GD_EDITOR.open(save, persist, startLevel);
    }, { color: '#c05aff' });

    drawAudioToggles(W - 150, 24);
    R.outlinedText('space / click to jump — hold to keep jumping', W / 2,
      H - 30, 16, '#8fa0d0');
  }

  function drawAudioToggles(x, y) {
    button(x, y, 56, 44, A.isEnabled('music') ? '♪' : '♪̶', function () {
      var on = !A.isEnabled('music');
      A.setEnabled('music', on);
      save.settings.music = on;
      persist();
      if (!on) A.stopMusic();
      else if (app.screen !== 'game') A.playTrack(A.MENU_TRACK);
    }, { color: A.isEnabled('music') ? '#52ff7a' : '#94a3c0', size: 24 });
    button(x + 68, y, 56, 44, A.isEnabled('sfx') ? '🔊' : '🔇', function () {
      var on = !A.isEnabled('sfx');
      A.setEnabled('sfx', on);
      save.settings.sfx = on;
      persist();
    }, { color: A.isEnabled('sfx') ? '#52ff7a' : '#94a3c0', size: 20 });
  }

  function drawSelect() {
    var meta = LEVELS[app.levelIdx];
    R.drawBackground(meta, timeMs, A.beatPhase());
    R.drawGround(meta, timeMs, A.beatPhase());
    var W = R.W(), H = R.H();
    R.outlinedText('SELECT LEVEL', W / 2, 70, 44, '#ffffff');

    var cw = 340, ch = 380, gap = 40;
    var total = LEVELS.length * cw + (LEVELS.length - 1) * gap;
    var x0 = (W - total) / 2;
    for (var i = 0; i < LEVELS.length; i++) {
      drawLevelCard(x0 + i * (cw + gap), H * 0.22, cw, ch, i);
    }
    button(40, 32, 120, 50, '← BACK', function () { app.screen = 'menu'; },
      { color: '#94a3c0', size: 20 });
  }

  function drawLevelCard(x, y, w, h, idx) {
    var lvl = LEVELS[idx];
    var ls = levelSave(lvl.id);
    var ctx = R.ctx();
    var accent = lvl.zones && lvl.zones.length
      ? lvl.zones[0].accent : '#39a0ff';

    button(x, y, w, h, '', function () { startLevel(idx); },
      { color: accent });

    R.outlinedText(lvl.name, x + w / 2, y + 54, 30, '#ffffff');
    R.outlinedText(lvl.difficulty, x + w / 2, y + 96, 20, accent);

    // Stars
    var stars = lvl.stars || 1;
    R.outlinedText('★ ' + stars, x + w / 2, y + 132, 22, '#ffd94a');

    // Best progress bar
    var bw = w - 80, bx = x + 40, by = y + 180;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,24,0.7)';
    R.roundRect(bx, by, bw, 16, 8);
    ctx.fill();
    if (ls.best > 0) {
      ctx.fillStyle = ls.completed ? '#52ff7a' : '#ffd94a';
      R.roundRect(bx, by, Math.max(16, bw * ls.best / 100), 16, 8);
      ctx.fill();
    }
    ctx.restore();
    R.outlinedText(ls.best + '%', x + w / 2, by + 44, 20,
      ls.completed ? '#52ff7a' : '#ffffff');

    // Coins
    for (var c = 0; c < 3; c++) {
      var cxp = x + w / 2 + (c - 1) * 44, cyp = y + 268;
      ctx.save();
      ctx.shadowColor = '#ffd94a';
      ctx.shadowBlur = ls.coins[c] ? 12 : 0;
      ctx.fillStyle = ls.coins[c] ? '#ffd94a' : 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(cxp, cyp, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ls.coins[c] ? '#fff3c0' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cxp, cyp, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    R.outlinedText('PLAY ▶', x + w / 2, y + h - 42, 24, accent);
  }

  function drawIcons() {
    var meta = LEVELS[0];
    R.drawBackground(meta, timeMs, A.beatPhase());
    R.drawGround(meta, timeMs, A.beatPhase());
    var W = R.W(), H = R.H();
    R.outlinedText('ICON KIT', W / 2, 70, 44);

    // Preview
    var ctx = R.ctx();
    ctx.save();
    ctx.translate(W / 2, H * 0.30);
    ctx.rotate(timeMs * 0.0012);
    R.drawCubeIcon(0, 0, 110, icon());
    ctx.restore();

    // Face styles
    var faces = 3;
    for (var f = 0; f < faces; f++) {
      (function (f) {
        var x = W / 2 - (faces * 90) / 2 + f * 90, y = H * 0.44;
        button(x, y, 74, 74, '', function () {
          save.settings.face = f; persist();
        }, { color: save.settings.face === f ? '#52ff7a' : '#39466e' });
        var ctx2 = R.ctx();
        ctx2.save();
        ctx2.translate(x + 37, y + 37);
        R.drawCubeIcon(0, 0, 46, { col1: save.settings.col1,
          col2: save.settings.col2, face: f });
        ctx2.restore();
      })(f);
    }

    // Colors
    R.outlinedText('PRIMARY', W / 2 - 260, H * 0.62, 20, '#c9d4ff', 'left');
    R.outlinedText('SECONDARY', W / 2 - 260, H * 0.62 + 84, 20, '#c9d4ff',
      'left');
    for (var s = 0; s < SWATCHES.length; s++) {
      (function (s) {
        var col = SWATCHES[s];
        var x = W / 2 - 260 + 110 + s * 44, y1 = H * 0.62 - 20,
          y2 = H * 0.62 + 64;
        button(x, y1, 36, 36, '', function () {
          save.settings.col1 = col; persist();
        }, { color: save.settings.col1 === col ? '#ffffff' : col });
        var ctx3 = R.ctx();
        ctx3.fillStyle = col;
        R.roundRect(x + 5, y1 + 5, 26, 26, 6);
        ctx3.fill();
        button(x, y2, 36, 36, '', function () {
          save.settings.col2 = col; persist();
        }, { color: save.settings.col2 === col ? '#ffffff' : col });
        ctx3.fillStyle = col;
        R.roundRect(x + 5, y2 + 5, 26, 26, 6);
        ctx3.fill();
      })(s);
    }

    button(40, 32, 120, 50, '← BACK', function () { app.screen = 'menu'; },
      { color: '#94a3c0', size: 20 });
  }

  // ------------------------------------------------------------------
  // Game screen
  // ------------------------------------------------------------------
  function drawGame(dt) {
    var g = game;
    var st = g.state;
    var meta = g.compiled.meta;
    var beat = A.beatPhase();

    if (!st.dead) updateCamera(dt, st, g);

    R.drawBackground(meta, timeMs, beat);
    R.drawGround(meta, timeMs, beat);

    // Practice checkpoints
    var ctx = R.ctx();
    if (g.practice) {
      for (var i = 0; i < g.checkpoints.length; i++) {
        var cp = g.checkpoints[i];
        ctx.save();
        ctx.translate(R.sx(cp.x + 15), R.sy(cp.y + 15));
        ctx.rotate(Math.PI / 4);
        ctx.shadowColor = '#52ff7a';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#52ff7a';
        ctx.fillRect(-8, -8, 16, 16);
        ctx.restore();
      }
    }

    var savedCoins = g.custom ? null : levelSave(meta.id).coins;
    R.drawObjects(g.compiled, st, timeMs, beat, savedCoins);

    // Wave trail ribbon
    if (g.trail.length > 1) {
      ctx.save();
      ctx.strokeStyle = save.settings.col2;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 7;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(R.sx(g.trail[0][0]), R.sy(g.trail[0][1]));
      for (var t = 1; t < g.trail.length; t++) {
        ctx.lineTo(R.sx(g.trail[t][0]), R.sy(g.trail[t][1]));
      }
      ctx.stroke();
      ctx.restore();
    }

    R.drawPlayer(st, icon(), timeMs, inputHeld && st.mode === MODE.SHIP);
    R.fx.update(dt);
    R.fx.draw();

    // Attempt text in the world at the spawn area
    var ax = g.practice && g.checkpoints.length
      ? g.checkpoints[g.checkpoints.length - 1].x : -C.BLOCK * 9;
    R.outlinedText('Attempt ' + g.attempts, R.sx(ax + 90), R.sy(140), 34,
      '#ffffff', 'center', 0.9);

    // HUD
    var accent = R.rgbCss(R.zoneColors(meta, st.x).ac);
    R.drawProgressBar(st.won ? 1 : SIM.progress(st), accent);
    if (g.practice) {
      R.outlinedText('PRACTICE', 110, 28, 20, '#52ff7a');
      R.outlinedText('Z checkpoint · X remove', 110, 54, 14, '#8fa0d0');
    }
    // Coins HUD
    for (var c = 0; c < 3; c++) {
      var got = st.coinsThisAttempt[c];
      var had = savedCoins && savedCoins[c];
      ctx.save();
      ctx.globalAlpha = got || had ? 1 : 0.3;
      ctx.fillStyle = got ? '#ffd94a' : had ? 'rgba(255,217,74,0.6)'
        : 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.arc(30 + c * 34, R.H() - 30, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    button(R.W() - 70, 16, 54, 44, 'II', togglePause,
      { color: '#94a3c0', size: 20, alpha: 0.85 });

    if (g.paused) drawPause();
    if (g.wonStats) drawWin();
  }

  function drawPause() {
    var W = R.W(), H = R.H();
    var ctx = R.ctx();
    ctx.fillStyle = 'rgba(8,10,26,0.72)';
    ctx.fillRect(0, 0, W, H);
    R.outlinedText('PAUSED', W / 2, H * 0.22, 56);

    var bw = 320, x = W / 2 - bw / 2;
    button(x, H * 0.34, bw, 58, 'RESUME', togglePause,
      { color: '#52ff7a', size: 24 });
    button(x, H * 0.34 + 76, bw, 58,
      game.practice ? 'PRACTICE: ON' : 'PRACTICE: OFF', function () {
        game.practice = !game.practice;
        game.checkpoints.length = 0;
        game.paused = false;
        game.attempts = 0;
        startAttempt();
      }, { color: game.practice ? '#52ff7a' : '#94a3c0', size: 22 });
    button(x, H * 0.34 + 152, bw, 58, 'RESTART', function () {
      game.paused = false;
      game.checkpoints.length = 0;
      game.attempts = 0;
      startAttempt();
    }, { color: '#ffd94a', size: 22 });
    button(x, H * 0.34 + 228, bw, 58, 'EXIT', exitToMenu,
      { color: '#ff5a5a', size: 22 });
    drawAudioToggles(W - 150, 24);
  }

  function drawWin() {
    var W = R.W(), H = R.H();
    var ctx = R.ctx();
    var ws = game.wonStats;
    ctx.fillStyle = 'rgba(8,10,26,0.62)';
    ctx.fillRect(0, 0, W, H);
    R.outlinedText('LEVEL COMPLETE!', W / 2, H * 0.24, 62, '#52ff7a');
    R.outlinedText('Attempts: ' + ws.attempts, W / 2, H * 0.36, 26);
    if (ws.practice) {
      R.outlinedText('(practice run — coins & stats not saved)', W / 2,
        H * 0.42, 18, '#8fa0d0');
    }
    for (var c = 0; c < 3; c++) {
      var got = ws.coins[c];
      ctx.save();
      ctx.shadowColor = '#ffd94a';
      ctx.shadowBlur = got ? 16 : 0;
      ctx.fillStyle = got ? '#ffd94a' : 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(W / 2 + (c - 1) * 60, H * 0.5, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    var bw = 260, x = W / 2 - bw / 2;
    if (!game.custom && game.levelIdx < LEVELS.length - 1) {
      button(x, H * 0.6, bw, 58, 'NEXT LEVEL', function () {
        startLevel(game.levelIdx + 1);
      }, { color: '#52ff7a', size: 22 });
    } else if (game.custom) {
      button(x, H * 0.6, bw, 58, 'BACK TO EDITOR', function () {
        app.screen = 'editor';
        game = null;
        global.GD_EDITOR.open(save, persist, startLevel);
      }, { color: '#c05aff', size: 20 });
    }
    button(x, H * 0.6 + 76, bw, 58, 'REPLAY', function () {
      game.checkpoints.length = 0;
      game.attempts = 0;
      game.wonStats = null;
      startAttempt();
    }, { color: '#ffd94a', size: 22 });
    button(x, H * 0.6 + 152, bw, 58, 'MENU', exitToMenu,
      { color: '#94a3c0', size: 22 });
  }

  // ------------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------------
  var canvas;
  function frame(now) {
    var dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;
    timeMs = now;

    app.buttons.length = 0;

    if (app.screen === 'menu') {
      stepAttract(Math.round(dt * C.PHYS_HZ));
      drawMenu();
    } else if (app.screen === 'select') {
      drawSelect();
    } else if (app.screen === 'icons') {
      drawIcons();
    } else if (app.screen === 'game' && game) {
      updateGame(dt);
      drawGame(dt);
    } else if (app.screen === 'editor' && global.GD_EDITOR) {
      global.GD_EDITOR.frame(dt, timeMs, button);
    }

    requestAnimationFrame(frame);
  }

  global.GD_APP = {
    boot: function (cv) {
      canvas = cv;
      R.init(cv);
      bindInput(cv);
      startAttract();
      requestAnimationFrame(function (t) {
        lastFrame = t;
        requestAnimationFrame(frame);
      });
    },
    // used by the editor to launch playtests
    startLevel: startLevel,
    exitToMenu: exitToMenu,
    getApp: function () { return app; },
    icon: icon
  };
})(typeof window !== 'undefined' ? window : globalThis);
