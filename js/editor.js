/*
 * Geometric Rush — level editor.
 *
 * Grid-based: click to place the selected object, right-drag (or the PAN
 * tool) to scroll, click an occupied cell with the eraser to remove.
 * Levels persist to localStorage and can be playtested in-engine.
 */
(function (global) {
  'use strict';

  var C = global.GD_CONST, R = global.GD_RENDER, SIM = global.GD_SIM;
  var T = C.T;

  var ed = null;
  var saveRef = null, persistRef = null, startLevelRef = null;

  var PALETTE = [
    { t: T.BLOCK, label: 'Block' },
    { t: T.SPIKE, label: 'Spike' },
    { t: T.SPIKE_DOWN, label: 'Ceil spike' },
    { t: T.SMALL_SPIKE, label: 'Small spike' },
    { t: T.SAW, label: 'Saw' },
    { t: T.PAD_YELLOW, label: 'Pad Y' },
    { t: T.PAD_PINK, label: 'Pad P' },
    { t: T.PAD_RED, label: 'Pad R' },
    { t: T.PAD_BLUE, label: 'Pad B' },
    { t: T.ORB_YELLOW, label: 'Orb Y' },
    { t: T.ORB_PINK, label: 'Orb P' },
    { t: T.ORB_RED, label: 'Orb R' },
    { t: T.ORB_BLUE, label: 'Orb B' },
    { t: T.ORB_GREEN, label: 'Orb G' },
    { t: T.ORB_BLACK, label: 'Orb K' },
    { t: T.PORTAL_CUBE, label: 'Cube' },
    { t: T.PORTAL_SHIP, label: 'Ship' },
    { t: T.PORTAL_BALL, label: 'Ball' },
    { t: T.PORTAL_UFO, label: 'UFO' },
    { t: T.PORTAL_WAVE, label: 'Wave' },
    { t: T.PORTAL_GRAV_UP, label: 'Grav ↑' },
    { t: T.PORTAL_GRAV_DOWN, label: 'Grav ↓' },
    { t: T.SPEED_1, label: '1x' },
    { t: T.SPEED_2, label: '2x' },
    { t: T.SPEED_3, label: '3x' },
    { t: T.COIN, label: 'Coin' },
    { t: T.FINISH, label: 'Finish' },
    { t: 'pit', label: 'Pit' },
    { t: 'erase', label: 'Erase' },
    { t: 'pan', label: 'Pan' }
  ];

  function blankLevel() {
    return {
      id: 'custom', name: 'My Level', difficulty: 'Custom', stars: 0,
      bpm: 140, musicId: 1, startMode: C.MODE.CUBE, startSpeed: 1,
      ceiling: 11, pits: {}, zones: [{ x: -600, bg: '#232a7a', accent: '#5ad2ff' }],
      objects: []
    };
  }

  function open(save, persist, startLevel) {
    saveRef = save; persistRef = persist; startLevelRef = startLevel;
    ed = {
      level: save.customLevel ? JSON.parse(JSON.stringify(save.customLevel))
        : blankLevel(),
      camX: -C.BLOCK * 4, camY: -58,
      tool: 0,
      dragging: false, panning: false,
      lastX: 0, lastY: 0,
      msg: '', msgT: 0
    };
    normalize();
  }

  function normalize() {
    if (!ed.level.pits) ed.level.pits = {};
    if (!ed.level.objects) ed.level.objects = [];
  }

  function toast(m) { ed.msg = m; ed.msgT = 2.2; }

  function doSave() {
    saveRef.customLevel = JSON.parse(JSON.stringify(ed.level));
    persistRef();
    toast('Saved!');
  }

  function cellFromScreen(x, y) {
    var wx = x / R.SCALE() + ed.camX;
    var wy = (R.H() - y) / R.SCALE() + ed.camY;
    return { cx: Math.floor(wx / C.BLOCK), cy: Math.floor(wy / C.BLOCK) };
  }

  function objectsAt(cx, cy) {
    var out = [];
    for (var i = 0; i < ed.level.objects.length; i++) {
      var o = ed.level.objects[i];
      var w = o.w || 1, h = o.h || 1;
      if (cx >= Math.floor(o.x) && cx < Math.ceil(o.x + w) &&
          cy >= Math.floor(o.y) && cy < Math.ceil(o.y + h)) {
        out.push(i);
      }
    }
    return out;
  }

  function place(cx, cy) {
    var tool = PALETTE[ed.tool];
    if (tool.t === 'pan') return;
    if (cy < 0 && tool.t !== 'pit') return;
    if (tool.t === 'pit') {
      if (ed.level.pits[cx]) delete ed.level.pits[cx];
      else ed.level.pits[cx] = true;
      return;
    }
    if (tool.t === 'erase') {
      var hits = objectsAt(cx, cy);
      if (hits.length) ed.level.objects.splice(hits[hits.length - 1], 1);
      return;
    }
    // No exact duplicates in one cell.
    var existing = objectsAt(cx, cy);
    for (var i = 0; i < existing.length; i++) {
      if (ed.level.objects[existing[i]].t === tool.t) return;
    }
    var o = { t: tool.t, x: cx, y: cy, w: 1, h: 1, rot: 0 };
    if (tool.t === T.SAW) { o.w = 2; o.h = 2; }
    if (tool.t >= T.PORTAL_CUBE && tool.t <= T.PORTAL_GRAV_DOWN) o.h = 4;
    if (tool.t >= T.SPEED_05 && tool.t <= T.SPEED_4) o.h = 2;
    if (tool.t === T.FINISH) { o.y = 0; o.h = 14; }
    if (tool.t === T.PAD_YELLOW || tool.t === T.PAD_PINK ||
        tool.t === T.PAD_BLUE || tool.t === T.PAD_RED) o.h = 0.4;
    if (tool.t === T.COIN) {
      var count = 0;
      for (var j = 0; j < ed.level.objects.length; j++) {
        if (ed.level.objects[j].t === T.COIN) count++;
      }
      if (count >= 3) { toast('Max 3 coins'); return; }
      o.rot = count;
    }
    ed.level.objects.push(o);
  }

  function playtest() {
    var lvl = JSON.parse(JSON.stringify(ed.level));
    var maxX = 20;
    var hasFinish = false;
    for (var i = 0; i < lvl.objects.length; i++) {
      maxX = Math.max(maxX, lvl.objects[i].x + (lvl.objects[i].w || 1));
      if (lvl.objects[i].t === T.FINISH) hasFinish = true;
    }
    if (!hasFinish) {
      lvl.objects.push({ t: T.FINISH, x: maxX + 16, y: 0, w: 1, h: 14 });
    }
    doSave();
    startLevelRef(0, { custom: lvl });
  }

  // ------------------------------------------------------------------
  // Input hooks (called from main.js)
  // ------------------------------------------------------------------
  function onDown(x, y) {
    if (!ed) return;
    var tool = PALETTE[ed.tool];
    ed.lastX = x; ed.lastY = y;
    if (y > R.H() - PALETTE_H) return; // palette handled by buttons
    if (tool.t === 'pan') { ed.panning = true; return; }
    ed.dragging = true;
    var c = cellFromScreen(x, y);
    place(c.cx, c.cy);
  }
  function onMove(x, y) {
    if (!ed) return;
    if (ed.panning) {
      ed.camX -= (x - ed.lastX) / R.SCALE();
      ed.camY += (y - ed.lastY) / R.SCALE();
      ed.camY = Math.max(-70, Math.min(300, ed.camY));
      ed.camX = Math.max(-C.BLOCK * 14, ed.camX);
      ed.lastX = x; ed.lastY = y;
      return;
    }
    if (ed.dragging && y <= R.H() - PALETTE_H) {
      var c = cellFromScreen(x, y);
      var tool = PALETTE[ed.tool];
      if (tool.t !== 'pit') place(c.cx, c.cy); // pits toggle — no drag paint
    }
    ed.lastX = x; ed.lastY = y;
  }
  function onUp() {
    if (!ed) return;
    ed.dragging = false;
    ed.panning = false;
  }
  function onKey(code) {
    if (!ed) return;
    var pan = C.BLOCK * 2;
    if (code === 'ArrowRight' || code === 'KeyD') ed.camX += pan;
    if (code === 'ArrowLeft' || code === 'KeyA') ed.camX = Math.max(-C.BLOCK * 14, ed.camX - pan);
    if (code === 'ArrowUp') ed.camY = Math.min(300, ed.camY + pan);
    if (code === 'ArrowDown') ed.camY = Math.max(-70, ed.camY - pan);
    if (code === 'Escape') exitEditor();
  }

  function exitEditor() {
    doSave();
    global.GD_APP.exitToMenu();
  }

  // ------------------------------------------------------------------
  // Frame
  // ------------------------------------------------------------------
  var PALETTE_H = 128;

  function frame(dt, timeMs, button) {
    if (!ed) return;
    R.setCam(ed.camX, ed.camY);
    var compiled = SIM.compileLevel(ed.level);
    R.drawBackground(ed.level, timeMs, 0);
    R.drawGround(ed.level, timeMs, 0);
    drawGrid();
    R.drawObjects(compiled, null, timeMs, 0, null);

    // Spawn marker
    var ctx = R.ctx();
    ctx.save();
    ctx.globalAlpha = 0.6;
    R.drawCubeIcon(R.sx(-C.BLOCK * 12 + 15), R.sy(15), 30 * R.SCALE() / 2.25,
      global.GD_APP.icon());
    ctx.restore();

    // Hover cell highlight
    if (ed.lastY <= R.H() - PALETTE_H) {
      var c = cellFromScreen(ed.lastX, ed.lastY);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(R.sx(c.cx * C.BLOCK), R.sy((c.cy + 1) * C.BLOCK),
        C.BLOCK * R.SCALE(), C.BLOCK * R.SCALE());
      ctx.restore();
    }

    drawPalette(button);

    R.outlinedText('EDITOR', R.W() / 2, 30, 28, '#c05aff');
    R.outlinedText('click: place · arrows/WASD: scroll · pan tool: drag',
      R.W() / 2, 60, 15, '#8fa0d0');

    if (ed.msgT > 0) {
      ed.msgT -= dt;
      R.outlinedText(ed.msg, R.W() / 2, 96, 22, '#52ff7a', 'center',
        Math.min(1, ed.msgT));
    }
  }

  function drawGrid() {
    var ctx = R.ctx();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    var c0 = Math.floor(ed.camX / C.BLOCK) - 1;
    var c1 = c0 + Math.ceil(C.VIEW_W / C.BLOCK) + 2;
    for (var cx = c0; cx <= c1; cx++) {
      ctx.beginPath();
      ctx.moveTo(R.sx(cx * C.BLOCK), 0);
      ctx.lineTo(R.sx(cx * C.BLOCK), R.H());
      ctx.stroke();
    }
    var r0 = Math.floor(ed.camY / C.BLOCK) - 1;
    var r1 = r0 + Math.ceil(C.VIEW_H / C.BLOCK) + 2;
    for (var cy = r0; cy <= r1; cy++) {
      ctx.beginPath();
      ctx.moveTo(0, R.sy(cy * C.BLOCK));
      ctx.lineTo(R.W(), R.sy(cy * C.BLOCK));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPalette(button) {
    var ctx = R.ctx();
    var W = R.W(), H = R.H();
    ctx.fillStyle = 'rgba(10,12,28,0.92)';
    ctx.fillRect(0, H - PALETTE_H, W, PALETTE_H);

    var bw = 74, bh = 34, gap = 6;
    var perRow = Math.floor((W - 240) / (bw + gap));
    for (var i = 0; i < PALETTE.length; i++) {
      (function (i) {
        var row = Math.floor(i / perRow), col = i % perRow;
        var x = 12 + col * (bw + gap);
        var y = H - PALETTE_H + 10 + row * (bh + gap);
        button(x, y, bw, bh, PALETTE[i].label, function () { ed.tool = i; },
          { color: ed.tool === i ? '#52ff7a' : '#39466e', size: 12 });
      })(i);
    }

    button(W - 220, H - PALETTE_H + 10, 96, 34, 'TEST ▶', playtest,
      { color: '#52ff7a', size: 15 });
    button(W - 114, H - PALETTE_H + 10, 96, 34, 'SAVE', doSave,
      { color: '#ffd94a', size: 15 });
    button(W - 220, H - PALETTE_H + 54, 96, 34, 'CLEAR', function () {
      ed.level = blankLevel();
      toast('Cleared');
    }, { color: '#ff5a5a', size: 15 });
    button(W - 114, H - PALETTE_H + 54, 96, 34, 'EXIT', exitEditor,
      { color: '#94a3c0', size: 15 });
  }

  global.GD_EDITOR = {
    open: open, frame: frame,
    onDown: onDown, onUp: onUp, onMove: onMove, onKey: onKey
  };
})(typeof window !== 'undefined' ? window : globalThis);
