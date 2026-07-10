/*
 * Geometric Rush — canvas renderer + particle effects.
 *
 * Every visual is drawn procedurally: no image assets. World y grows upward;
 * the transform in worldToScreen flips it for the canvas.
 */
(function (global) {
  'use strict';

  var C = global.GD_CONST;
  var T = C.T, MODE = C.MODE;

  var canvas, ctx2d, W = 1280, H = 720, SCALE = H / C.VIEW_H;

  function init(cv) {
    canvas = cv;
    ctx2d = cv.getContext('2d');
    resize();
  }

  function resize() {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var ww = global.innerWidth, wh = global.innerHeight;
    var aspect = 16 / 9;
    var cw = ww, ch = ww / aspect;
    if (ch > wh) { ch = wh; cw = wh * aspect; }
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    // Render at device resolution; all drawing stays in 1280x720 logical
    // coordinates via the base transform.
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ------------------------------------------------------------------
  // Color helpers
  // ------------------------------------------------------------------
  function hexRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16)];
  }
  function rgbCss(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' +
      (a == null ? 1 : a) + ')';
  }
  function lerpC(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t];
  }
  function scaleC(c, f) { return [c[0] * f, c[1] * f, c[2] * f]; }

  // Current zone colors at world x, blending across 10 blocks.
  function zoneColors(meta, wx) {
    var zones = meta.zones && meta.zones.length
      ? meta.zones : [{ x: -1e9, bg: '#1b2a6b', accent: '#39a0ff' }];
    var cur = zones[0], next = null;
    for (var i = 0; i < zones.length; i++) {
      if (wx >= zones[i].x) cur = zones[i];
      else { next = zones[i]; break; }
    }
    var bg = hexRgb(cur.bg), ac = hexRgb(cur.accent);
    if (next) {
      var span = C.BLOCK * 10;
      var t = 1 - Math.min(1, (next.x - wx) / span);
      if (t > 0) {
        bg = lerpC(bg, hexRgb(next.bg), t);
        ac = lerpC(ac, hexRgb(next.accent), t);
      }
    }
    return { bg: bg, ac: ac };
  }

  // ------------------------------------------------------------------
  // Transform
  // ------------------------------------------------------------------
  var camX = 0, camY = -58;
  function setCam(x, y) { camX = x; camY = y; }
  function sx(wx) { return (wx - camX) * SCALE; }
  function sy(wy) { return H - (wy - camY) * SCALE; }

  // ------------------------------------------------------------------
  // Primitive helpers
  // ------------------------------------------------------------------
  function roundRect(x, y, w, h, r) {
    ctx2d.beginPath();
    ctx2d.moveTo(x + r, y);
    ctx2d.arcTo(x + w, y, x + w, y + h, r);
    ctx2d.arcTo(x + w, y + h, x, y + h, r);
    ctx2d.arcTo(x, y + h, x, y, r);
    ctx2d.arcTo(x, y, x + w, y, r);
    ctx2d.closePath();
  }

  function outlinedText(text, x, y, size, fill, align, alpha) {
    ctx2d.save();
    ctx2d.globalAlpha = alpha == null ? 1 : alpha;
    ctx2d.font = '900 ' + size + 'px "Arial Black", Arial, sans-serif';
    ctx2d.textAlign = align || 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.lineJoin = 'round';
    ctx2d.strokeStyle = 'rgba(8,10,24,0.95)';
    ctx2d.lineWidth = Math.max(3, size * 0.14);
    ctx2d.strokeText(text, x, y);
    ctx2d.fillStyle = fill || '#ffffff';
    ctx2d.fillText(text, x, y);
    ctx2d.restore();
  }

  // ------------------------------------------------------------------
  // Background + ground
  // ------------------------------------------------------------------
  function drawBackground(meta, timeMs, beat) {
    var zc = zoneColors(meta, camX + C.VIEW_W * 0.5);
    var top = scaleC(zc.bg, 0.55), bot = zc.bg;
    var g = ctx2d.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgbCss(top));
    g.addColorStop(1, rgbCss(bot));
    ctx2d.fillStyle = g;
    ctx2d.fillRect(0, 0, W, H);

    var pulse = 1 + beatPulse(beat) * 0.04;

    // Two parallax layers of large drifting diamonds.
    for (var layer = 0; layer < 2; layer++) {
      var par = layer === 0 ? 0.18 : 0.36;
      var size = (layer === 0 ? 210 : 120) * pulse;
      var alpha = layer === 0 ? 0.10 : 0.13;
      var spacing = layer === 0 ? 460 : 300;
      var off = camX * par * SCALE;
      ctx2d.fillStyle = rgbCss(lerpC(zc.bg, [255, 255, 255], 0.16), alpha);
      var first = Math.floor((off - size) / spacing);
      for (var i = first; i * spacing - off < W + size; i++) {
        var px = i * spacing - off;
        var py = 130 + ((i * 2654435761 >>> 0) % 1000) / 1000 * (H * 0.55);
        ctx2d.save();
        ctx2d.translate(px, py);
        ctx2d.rotate(Math.PI / 4 + timeMs * 0.00004 * (layer + 1));
        ctx2d.fillRect(-size / 2, -size / 2, size, size);
        ctx2d.restore();
      }
    }
  }

  function beatPulse(beat) {
    var f = beat - Math.floor(beat);
    return Math.max(0, 1 - f * 3.2);
  }

  function drawGround(meta, timeMs, beat) {
    var zc = zoneColors(meta, camX + C.VIEW_W * 0.5);
    var gy = sy(C.GROUND_Y);
    if (gy > H) return;
    var dark = scaleC(zc.bg, 0.5);
    var g = ctx2d.createLinearGradient(0, gy, 0, H);
    g.addColorStop(0, rgbCss(scaleC(zc.bg, 0.72)));
    g.addColorStop(1, rgbCss(dark));
    ctx2d.fillStyle = g;

    // The ground plane, skipping pit columns.
    var c0 = Math.floor(camX / C.BLOCK) - 1;
    var c1 = Math.floor((camX + C.VIEW_W) / C.BLOCK) + 1;
    for (var c = c0; c <= c1; c++) {
      if (meta.pits && meta.pits[c]) continue;
      ctx2d.fillRect(sx(c * C.BLOCK) - 0.5, gy, C.BLOCK * SCALE + 1, H - gy);
    }
    // Glowing edge line.
    ctx2d.save();
    ctx2d.shadowColor = rgbCss(zc.ac, 0.9);
    ctx2d.shadowBlur = 10 + beatPulse(beat) * 8;
    ctx2d.strokeStyle = rgbCss(lerpC(zc.ac, [255, 255, 255], 0.5));
    ctx2d.lineWidth = 3;
    for (var c2 = c0; c2 <= c1; c2++) {
      if (meta.pits && meta.pits[c2]) continue;
      ctx2d.beginPath();
      ctx2d.moveTo(sx(c2 * C.BLOCK) - 1, gy);
      ctx2d.lineTo(sx((c2 + 1) * C.BLOCK) + 1, gy);
      ctx2d.stroke();
    }
    ctx2d.restore();

    // Chevron stripes sliding with the world.
    ctx2d.save();
    ctx2d.globalAlpha = 0.10;
    ctx2d.strokeStyle = rgbCss(zc.ac);
    ctx2d.lineWidth = 10;
    var period = 90;
    var offx = -(camX * SCALE) % period;
    for (var px = offx - period; px < W + period; px += period) {
      ctx2d.beginPath();
      ctx2d.moveTo(px, H);
      ctx2d.lineTo(px + 46, gy + 6);
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  // ------------------------------------------------------------------
  // Objects
  // ------------------------------------------------------------------
  var PORTAL_COLORS = {};
  PORTAL_COLORS[T.PORTAL_CUBE] = '#41e0b6';
  PORTAL_COLORS[T.PORTAL_SHIP] = '#ff9d3f';
  PORTAL_COLORS[T.PORTAL_BALL] = '#ff5a5a';
  PORTAL_COLORS[T.PORTAL_UFO] = '#ffd94a';
  PORTAL_COLORS[T.PORTAL_WAVE] = '#5a7bff';
  PORTAL_COLORS[T.PORTAL_GRAV_UP] = '#c05aff';
  PORTAL_COLORS[T.PORTAL_GRAV_DOWN] = '#37a0ff';

  var PAD_COLORS = {};
  PAD_COLORS[T.PAD_YELLOW] = '#ffd94a';
  PAD_COLORS[T.PAD_PINK] = '#ff6bd6';
  PAD_COLORS[T.PAD_BLUE] = '#4ac6ff';
  PAD_COLORS[T.PAD_RED] = '#ff5240';

  var ORB_COLORS = {};
  ORB_COLORS[T.ORB_YELLOW] = '#ffd94a';
  ORB_COLORS[T.ORB_PINK] = '#ff6bd6';
  ORB_COLORS[T.ORB_RED] = '#ff5240';
  ORB_COLORS[T.ORB_BLUE] = '#4ac6ff';
  ORB_COLORS[T.ORB_GREEN] = '#52ff7a';
  ORB_COLORS[T.ORB_BLACK] = '#20242e';

  function drawObjects(compiled, state, timeMs, beat, savedCoins) {
    var objs = global.GD_SIM.queryRange(compiled, camX - C.BLOCK * 2,
      camX + C.VIEW_W + C.BLOCK * 2);
    objs.sort(function (a, b) { return a.id - b.id; });
    var zc = zoneColors(compiled.meta, camX + C.VIEW_W * 0.5);

    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      var x = sx(o.x), y = sy(o.y + o.h), w = o.w * SCALE, h = o.h * SCALE;
      switch (o.type) {
        case T.BLOCK: case T.HALF: drawBlock(x, y, w, h, zc); break;
        case T.SPIKE: drawSpike(o, zc, false, 1); break;
        case T.SPIKE_DOWN: drawSpike(o, zc, true, 1); break;
        case T.SMALL_SPIKE: drawSpike(o, zc, false, 0.5); break;
        case T.SAW: drawSaw(o, zc, timeMs); break;
        case T.PAD_YELLOW: case T.PAD_PINK: case T.PAD_BLUE: case T.PAD_RED:
          drawPad(o, state); break;
        case T.ORB_YELLOW: case T.ORB_PINK: case T.ORB_RED: case T.ORB_BLUE:
        case T.ORB_GREEN: case T.ORB_BLACK:
          drawOrb(o, state, beat); break;
        case T.PORTAL_CUBE: case T.PORTAL_SHIP: case T.PORTAL_BALL:
        case T.PORTAL_UFO: case T.PORTAL_WAVE:
        case T.PORTAL_GRAV_UP: case T.PORTAL_GRAV_DOWN:
          drawPortal(o, timeMs); break;
        case T.SPEED_05: case T.SPEED_1: case T.SPEED_2: case T.SPEED_3:
        case T.SPEED_4:
          drawSpeed(o, timeMs); break;
        case T.COIN: drawCoin(o, state, timeMs, savedCoins); break;
        case T.FINISH: drawFinish(o, timeMs); break;
        case T.DECO_SPIKES: drawDecoSpikes(o, zc); break;
        case T.CHAIN: drawChain(o, zc); break;
        case T.ARROW: drawArrowHint(o, timeMs); break;
      }
    }
  }

  function drawBlock(x, y, w, h, zc) {
    var body = ctx2d.createLinearGradient(0, y, 0, y + h);
    body.addColorStop(0, 'rgba(24,28,44,0.97)');
    body.addColorStop(1, 'rgba(12,14,26,0.97)');
    ctx2d.fillStyle = body;
    ctx2d.fillRect(x, y, w, h);
    ctx2d.save();
    ctx2d.strokeStyle = rgbCss(lerpC(zc.ac, [255, 255, 255], 0.55), 0.95);
    ctx2d.lineWidth = 2;
    ctx2d.shadowColor = rgbCss(zc.ac, 0.8);
    ctx2d.shadowBlur = 7;
    ctx2d.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx2d.restore();
    // Inner grid lines every block, for big merged slabs.
    ctx2d.save();
    ctx2d.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx2d.lineWidth = 1;
    var bs = C.BLOCK * SCALE;
    for (var gx = x + bs; gx < x + w - 2; gx += bs) {
      ctx2d.beginPath(); ctx2d.moveTo(gx, y + 2); ctx2d.lineTo(gx, y + h - 2);
      ctx2d.stroke();
    }
    for (var gy = y + bs; gy < y + h - 2; gy += bs) {
      ctx2d.beginPath(); ctx2d.moveTo(x + 2, gy); ctx2d.lineTo(x + w - 2, gy);
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function drawSpike(o, zc, flip, hFrac) {
    var x0 = sx(o.x), x1 = sx(o.x + o.w);
    var yb = flip ? sy(o.y + o.h) : sy(o.y);
    var yt = flip ? sy(o.y + o.h * (1 - hFrac)) : sy(o.y + o.h * hFrac);
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.moveTo(x0, yb);
    ctx2d.lineTo((x0 + x1) / 2, yt);
    ctx2d.lineTo(x1, yb);
    ctx2d.closePath();
    var g = ctx2d.createLinearGradient(0, Math.min(yb, yt), 0, Math.max(yb, yt));
    g.addColorStop(0, 'rgba(30,34,52,0.98)');
    g.addColorStop(1, 'rgba(14,16,30,0.98)');
    ctx2d.fillStyle = g;
    ctx2d.fill();
    ctx2d.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx2d.lineWidth = 2;
    ctx2d.shadowColor = rgbCss(zc.ac, 0.75);
    ctx2d.shadowBlur = 6;
    ctx2d.stroke();
    ctx2d.restore();
  }

  function drawDecoSpikes(o, zc) {
    var n = Math.round(o.w / C.BLOCK) * 2;
    var bw = o.w / n;
    ctx2d.save();
    ctx2d.globalAlpha = 0.35;
    ctx2d.fillStyle = 'rgba(10,12,24,1)';
    ctx2d.beginPath();
    for (var i = 0; i < n; i++) {
      var x0 = sx(o.x + i * bw), x1 = sx(o.x + (i + 1) * bw);
      ctx2d.moveTo(x0, sy(o.y));
      ctx2d.lineTo((x0 + x1) / 2, sy(o.y + C.BLOCK * 0.6));
      ctx2d.lineTo(x1, sy(o.y));
    }
    ctx2d.fill();
    ctx2d.restore();
  }

  function drawChain(o, zc) {
    var x = sx(o.x + o.w / 2);
    ctx2d.save();
    ctx2d.globalAlpha = 0.5;
    ctx2d.strokeStyle = rgbCss(zc.ac, 0.8);
    ctx2d.lineWidth = 4;
    ctx2d.beginPath();
    ctx2d.moveTo(x, sy(o.y));
    ctx2d.lineTo(x, sy(o.y + o.h));
    ctx2d.stroke();
    for (var ry = 0; ry <= o.h; ry += C.BLOCK * 0.75) {
      ctx2d.beginPath();
      ctx2d.arc(x, sy(o.y + ry), 6, 0, Math.PI * 2);
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function drawSaw(o, zc, timeMs) {
    var cx = sx(o.x + o.w / 2), cy = sy(o.y + o.h / 2);
    var r = (o.w / 2) * SCALE;
    var rot = timeMs * 0.006 * ((o.id % 2) ? 1 : -1);
    ctx2d.save();
    ctx2d.translate(cx, cy);
    ctx2d.rotate(rot);
    ctx2d.shadowColor = rgbCss(zc.ac, 0.85);
    ctx2d.shadowBlur = 10;
    // Teeth
    var teeth = 8;
    ctx2d.beginPath();
    for (var i = 0; i < teeth; i++) {
      var a0 = (i / teeth) * Math.PI * 2;
      var a1 = ((i + 0.5) / teeth) * Math.PI * 2;
      var a2 = ((i + 1) / teeth) * Math.PI * 2;
      ctx2d.lineTo(Math.cos(a0) * r * 0.72, Math.sin(a0) * r * 0.72);
      ctx2d.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
      ctx2d.lineTo(Math.cos(a2) * r * 0.72, Math.sin(a2) * r * 0.72);
    }
    ctx2d.closePath();
    ctx2d.fillStyle = 'rgba(22,25,40,0.98)';
    ctx2d.fill();
    ctx2d.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx2d.lineWidth = 2.5;
    ctx2d.stroke();
    ctx2d.shadowBlur = 0;
    ctx2d.beginPath();
    ctx2d.arc(0, 0, r * 0.3, 0, Math.PI * 2);
    ctx2d.strokeStyle = rgbCss(zc.ac);
    ctx2d.lineWidth = 3;
    ctx2d.stroke();
    ctx2d.beginPath();
    ctx2d.arc(0, 0, r * 0.09, 0, Math.PI * 2);
    ctx2d.fillStyle = 'rgba(255,255,255,0.9)';
    ctx2d.fill();
    ctx2d.restore();
  }

  function drawPad(o, state) {
    var used = state && state.usedOnce[o.id];
    var col = PAD_COLORS[o.type];
    var x = sx(o.x), w = o.w * SCALE;
    var flip = false; // pads sit on whatever they were authored on
    var y = sy(o.y);
    ctx2d.save();
    ctx2d.globalAlpha = used ? 0.45 : 1;
    ctx2d.shadowColor = col;
    ctx2d.shadowBlur = 14;
    ctx2d.fillStyle = col;
    roundRect(x + w * 0.08, y - 8, w * 0.84, 8, 4);
    ctx2d.fill();
    ctx2d.shadowBlur = 0;
    ctx2d.fillStyle = 'rgba(255,255,255,0.75)';
    roundRect(x + w * 0.2, y - 8, w * 0.6, 3.5, 2);
    ctx2d.fill();
    ctx2d.restore();
  }

  function drawOrb(o, state, beat) {
    var used = state && state.usedOnce[o.id];
    var col = ORB_COLORS[o.type];
    var cx = sx(o.x + o.w / 2), cy = sy(o.y + o.h / 2);
    var r = 13 * SCALE / 2.25;
    var pulse = 1 + beatPulse(beat) * 0.18;
    ctx2d.save();
    ctx2d.globalAlpha = used ? 0.35 : 1;
    ctx2d.shadowColor = col;
    ctx2d.shadowBlur = 16;
    ctx2d.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx2d.lineWidth = 2.5;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r * 1.45 * pulse, 0, Math.PI * 2);
    ctx2d.stroke();
    ctx2d.fillStyle = col;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.shadowBlur = 0;
    ctx2d.fillStyle = 'rgba(255,255,255,0.55)';
    ctx2d.beginPath();
    ctx2d.arc(cx - r * 0.3, cy - r * 0.35, r * 0.32, 0, Math.PI * 2);
    ctx2d.fill();
    if (o.type === T.ORB_BLACK) {
      ctx2d.strokeStyle = '#ffffff';
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(cx, cy - r * 0.5); ctx2d.lineTo(cx, cy + r * 0.55);
      ctx2d.moveTo(cx - r * 0.4, cy + r * 0.1); ctx2d.lineTo(cx, cy + r * 0.55);
      ctx2d.moveTo(cx + r * 0.4, cy + r * 0.1); ctx2d.lineTo(cx, cy + r * 0.55);
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function drawPortal(o, timeMs) {
    var col = PORTAL_COLORS[o.type];
    var x = sx(o.x), y = sy(o.y + o.h);
    var w = o.w * SCALE, h = o.h * SCALE;
    var cx = x + w / 2;
    ctx2d.save();
    ctx2d.shadowColor = col;
    ctx2d.shadowBlur = 18;
    ctx2d.strokeStyle = col;
    ctx2d.lineWidth = 5;
    roundRect(cx - w * 0.62, y, w * 1.24, h, w * 0.62);
    ctx2d.stroke();
    ctx2d.globalAlpha = 0.22;
    ctx2d.fillStyle = col;
    roundRect(cx - w * 0.62, y, w * 1.24, h, w * 0.62);
    ctx2d.fill();
    ctx2d.globalAlpha = 0.75;
    ctx2d.lineWidth = 2;
    var t = timeMs * 0.004;
    for (var i = 0; i < 3; i++) {
      var yy = y + h * (((t * 0.35 + i / 3) % 1));
      var sw = Math.sin((t + i) * 2.1) * w * 0.28;
      ctx2d.beginPath();
      ctx2d.moveTo(cx - w * 0.3 + sw, yy);
      ctx2d.lineTo(cx + w * 0.3 + sw, yy);
      ctx2d.stroke();
    }
    // Gravity portals show direction.
    if (o.type === T.PORTAL_GRAV_UP || o.type === T.PORTAL_GRAV_DOWN) {
      var up = o.type === T.PORTAL_GRAV_UP;
      ctx2d.globalAlpha = 0.95;
      ctx2d.fillStyle = '#ffffff';
      var ay = y + h / 2, s = 9;
      ctx2d.beginPath();
      if (up) {
        ctx2d.moveTo(cx, ay - s); ctx2d.lineTo(cx + s, ay + s);
        ctx2d.lineTo(cx - s, ay + s);
      } else {
        ctx2d.moveTo(cx, ay + s); ctx2d.lineTo(cx + s, ay - s);
        ctx2d.lineTo(cx - s, ay - s);
      }
      ctx2d.closePath();
      ctx2d.fill();
    }
    ctx2d.restore();
  }

  function drawSpeed(o, timeMs) {
    var n = o.type - T.SPEED_05; // 0..4 chevrons-1
    var col = '#9dff57';
    var x = sx(o.x), y = sy(o.y);
    ctx2d.save();
    ctx2d.shadowColor = col;
    ctx2d.shadowBlur = 10;
    ctx2d.strokeStyle = col;
    ctx2d.lineWidth = 4;
    var count = Math.max(1, n);
    var ph = (timeMs * 0.003) % 1;
    for (var i = 0; i < count; i++) {
      var xx = x + 6 + i * 11 + ph * 4;
      ctx2d.globalAlpha = 0.5 + 0.5 * Math.sin(ph * Math.PI);
      ctx2d.beginPath();
      ctx2d.moveTo(xx, y - 40);
      ctx2d.lineTo(xx + 10, y - 25);
      ctx2d.lineTo(xx, y - 10);
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function drawCoin(o, state, timeMs, savedCoins) {
    var idx = o.rot | 0;
    var gotNow = state && state.coinsThisAttempt[idx];
    var gotBefore = savedCoins && savedCoins[idx];
    if (gotNow) return; // burst particles cover the pickup
    var cx = sx(o.x + o.w / 2), cy = sy(o.y + o.h / 2);
    var r = 12 * SCALE / 2.25;
    var squish = Math.abs(Math.cos(timeMs * 0.0035 + idx));
    ctx2d.save();
    ctx2d.translate(cx, cy);
    ctx2d.scale(Math.max(0.14, squish), 1);
    ctx2d.shadowColor = '#ffd94a';
    ctx2d.shadowBlur = 14;
    ctx2d.lineWidth = 3;
    if (gotBefore) {
      ctx2d.globalAlpha = 0.45;
      ctx2d.strokeStyle = '#ffd94a';
      ctx2d.beginPath(); ctx2d.arc(0, 0, r, 0, Math.PI * 2); ctx2d.stroke();
      ctx2d.beginPath(); ctx2d.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx2d.stroke();
    } else {
      ctx2d.fillStyle = '#ffd94a';
      ctx2d.beginPath(); ctx2d.arc(0, 0, r, 0, Math.PI * 2); ctx2d.fill();
      ctx2d.strokeStyle = '#fff3c0';
      ctx2d.beginPath(); ctx2d.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function drawFinish(o, timeMs) {
    var x = sx(o.x + o.w / 2);
    var y0 = sy(o.y), y1 = sy(o.y + o.h);
    ctx2d.save();
    ctx2d.shadowColor = '#ffffff';
    ctx2d.shadowBlur = 16;
    var t = timeMs * 0.002;
    for (var i = 0; i < 3; i++) {
      ctx2d.globalAlpha = 0.35 + 0.3 * Math.sin(t * 2 + i * 2);
      ctx2d.strokeStyle = i === 1 ? '#ffffff' : '#9dff57';
      ctx2d.lineWidth = 6 - i * 1.5;
      ctx2d.beginPath();
      ctx2d.moveTo(x + (i - 1) * 8, y0);
      ctx2d.lineTo(x + (i - 1) * 8, y1);
      ctx2d.stroke();
    }
    ctx2d.globalAlpha = 0.9;
    for (var fy = 0; fy < 8; fy++) {
      var yy = y1 + (y0 - y1) * (fy / 8);
      ctx2d.fillStyle = fy % 2 ? '#ffffff' : '#0c0e1a';
      ctx2d.fillRect(x - 4, yy, 8, (y0 - y1) / 8);
    }
    ctx2d.restore();
  }

  function drawArrowHint(o, timeMs) {
    var cx = sx(o.x + o.w / 2), cy = sy(o.y + o.h / 2);
    var a = 0.35 + 0.3 * Math.sin(timeMs * 0.005);
    ctx2d.save();
    ctx2d.globalAlpha = a;
    ctx2d.strokeStyle = '#ffffff';
    ctx2d.lineWidth = 4;
    ctx2d.beginPath();
    if (o.rot) { // up
      ctx2d.moveTo(cx - 8, cy + 6); ctx2d.lineTo(cx, cy - 8);
      ctx2d.lineTo(cx + 8, cy + 6);
    } else { // forward
      ctx2d.moveTo(cx - 6, cy - 8); ctx2d.lineTo(cx + 8, cy);
      ctx2d.lineTo(cx - 6, cy + 8);
    }
    ctx2d.stroke();
    ctx2d.restore();
  }

  // ------------------------------------------------------------------
  // Player
  // ------------------------------------------------------------------
  function drawPlayer(state, icon, timeMs, thrusting) {
    if (!state || state.dead) return;
    var szU = global.GD_SIM.playerSize(state);
    var px = sx(state.x + 15), py = sy(state.y + szU / 2);
    var s = C.CUBE.size * SCALE; // icon draw size (constant across modes)
    ctx2d.save();
    ctx2d.translate(px, py);
    if (state.gravDir === -1) ctx2d.scale(1, -1);

    if (state.mode === MODE.CUBE) {
      ctx2d.rotate(state.rotation * state.gravDir);
      drawCubeIcon(0, 0, s, icon);
    } else if (state.mode === MODE.SHIP) {
      var tilt = Math.max(-0.5, Math.min(0.5, -state.vy * state.gravDir * 0.0012));
      ctx2d.rotate(tilt);
      drawShipIcon(0, 0, s, icon, thrusting, timeMs);
    } else if (state.mode === MODE.BALL) {
      ctx2d.rotate(state.rotation * state.gravDir);
      drawBallIcon(0, 0, s, icon);
    } else if (state.mode === MODE.UFO) {
      drawUfoIcon(0, 0, s, icon);
    } else if (state.mode === MODE.WAVE) {
      var ang = state.vy * state.gravDir > 10 ? -Math.PI / 4
        : state.vy * state.gravDir < -10 ? Math.PI / 4 : 0;
      ctx2d.rotate(ang);
      drawWaveIcon(0, 0, s * 0.9, icon);
    }
    ctx2d.restore();
  }

  function drawCubeIcon(cx, cy, s, icon) {
    var h = s / 2;
    ctx2d.save();
    ctx2d.translate(cx, cy);
    ctx2d.shadowColor = icon.col2;
    ctx2d.shadowBlur = 10;
    ctx2d.fillStyle = icon.col1;
    roundRect(-h, -h, s, s, s * 0.14);
    ctx2d.fill();
    ctx2d.shadowBlur = 0;
    ctx2d.strokeStyle = icon.col2;
    ctx2d.lineWidth = Math.max(2.5, s * 0.09);
    roundRect(-h, -h, s, s, s * 0.14);
    ctx2d.stroke();
    // Face styles
    ctx2d.fillStyle = '#ffffff';
    if (icon.face === 1) { // visor
      roundRect(-h * 0.58, -h * 0.42, s * 0.58, s * 0.30, s * 0.06);
      ctx2d.fill();
      ctx2d.fillStyle = icon.col2;
      ctx2d.fillRect(-h * 0.30, -h * 0.34, s * 0.10, s * 0.22);
    } else if (icon.face === 2) { // determined
      ctx2d.save();
      ctx2d.rotate(0.18);
      ctx2d.fillRect(-h * 0.62, -h * 0.5, s * 0.22, s * 0.1);
      ctx2d.restore();
      ctx2d.save();
      ctx2d.rotate(-0.18);
      ctx2d.fillRect(h * 0.18, -h * 0.5, s * 0.22, s * 0.1);
      ctx2d.restore();
      ctx2d.fillRect(-h * 0.52, -h * 0.34, s * 0.18, s * 0.24);
      ctx2d.fillRect(h * 0.16, -h * 0.34, s * 0.18, s * 0.24);
      ctx2d.fillRect(-h * 0.3, h * 0.28, s * 0.3, s * 0.09);
    } else { // classic
      ctx2d.fillRect(-h * 0.52, -h * 0.4, s * 0.2, s * 0.28);
      ctx2d.fillRect(h * 0.12, -h * 0.4, s * 0.2, s * 0.28);
      ctx2d.strokeStyle = '#ffffff';
      ctx2d.lineWidth = Math.max(2, s * 0.07);
      ctx2d.beginPath();
      ctx2d.arc(0, h * 0.12, s * 0.24, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function drawShipIcon(cx, cy, s, icon, thrusting, timeMs) {
    ctx2d.save();
    ctx2d.translate(cx, cy);
    // Mini cube pilot
    ctx2d.save();
    ctx2d.translate(0, -s * 0.18);
    ctx2d.scale(0.52, 0.52);
    drawCubeIcon(0, 0, s, icon);
    ctx2d.restore();
    // Hull
    ctx2d.shadowColor = icon.col2;
    ctx2d.shadowBlur = 10;
    ctx2d.fillStyle = icon.col1;
    ctx2d.beginPath();
    ctx2d.moveTo(-s * 0.75, s * 0.05);
    ctx2d.quadraticCurveTo(-s * 0.2, -s * 0.28, s * 0.62, -s * 0.05);
    ctx2d.quadraticCurveTo(s * 0.8, s * 0.05, s * 0.6, s * 0.22);
    ctx2d.quadraticCurveTo(0, s * 0.5, -s * 0.62, s * 0.3);
    ctx2d.closePath();
    ctx2d.fill();
    ctx2d.shadowBlur = 0;
    ctx2d.strokeStyle = icon.col2;
    ctx2d.lineWidth = Math.max(2.5, s * 0.08);
    ctx2d.stroke();
    // Fin
    ctx2d.fillStyle = icon.col2;
    ctx2d.beginPath();
    ctx2d.moveTo(-s * 0.52, s * 0.02);
    ctx2d.lineTo(-s * 0.8, -s * 0.3);
    ctx2d.lineTo(-s * 0.3, -s * 0.05);
    ctx2d.closePath();
    ctx2d.fill();
    // Thruster flame
    if (thrusting) {
      var fl = (Math.sin(timeMs * 0.05) * 0.25 + 1) * s * 0.5;
      var g = ctx2d.createLinearGradient(-s * 0.7 - fl, 0, -s * 0.6, 0);
      g.addColorStop(0, 'rgba(255,214,74,0)');
      g.addColorStop(1, 'rgba(255,214,74,0.95)');
      ctx2d.fillStyle = g;
      ctx2d.beginPath();
      ctx2d.moveTo(-s * 0.66, s * 0.06);
      ctx2d.lineTo(-s * 0.66 - fl, s * 0.16);
      ctx2d.lineTo(-s * 0.6, s * 0.27);
      ctx2d.closePath();
      ctx2d.fill();
    }
    ctx2d.restore();
  }

  function drawBallIcon(cx, cy, s, icon) {
    var r = s * 0.52;
    ctx2d.save();
    ctx2d.translate(cx, cy);
    ctx2d.shadowColor = icon.col2;
    ctx2d.shadowBlur = 10;
    ctx2d.fillStyle = icon.col1;
    ctx2d.beginPath(); ctx2d.arc(0, 0, r, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.shadowBlur = 0;
    ctx2d.fillStyle = icon.col2;
    ctx2d.beginPath();
    ctx2d.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
    ctx2d.closePath();
    ctx2d.fill();
    ctx2d.strokeStyle = '#ffffff';
    ctx2d.lineWidth = Math.max(2.5, s * 0.08);
    ctx2d.beginPath(); ctx2d.arc(0, 0, r, 0, Math.PI * 2); ctx2d.stroke();
    ctx2d.beginPath();
    ctx2d.moveTo(0, -r); ctx2d.lineTo(0, r);
    ctx2d.stroke();
    ctx2d.fillStyle = '#ffffff';
    ctx2d.beginPath(); ctx2d.arc(0, 0, r * 0.2, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.restore();
  }

  function drawUfoIcon(cx, cy, s, icon) {
    ctx2d.save();
    ctx2d.translate(cx, cy);
    // Dome with mini cube
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.arc(0, -s * 0.05, s * 0.42, Math.PI, 0);
    ctx2d.closePath();
    ctx2d.clip();
    ctx2d.fillStyle = 'rgba(190,235,255,0.5)';
    ctx2d.fillRect(-s * 0.45, -s * 0.5, s * 0.9, s * 0.5);
    ctx2d.translate(0, -s * 0.16);
    ctx2d.scale(0.4, 0.4);
    drawCubeIcon(0, 0, s, icon);
    ctx2d.restore();
    ctx2d.strokeStyle = '#ffffff';
    ctx2d.lineWidth = Math.max(2, s * 0.06);
    ctx2d.beginPath();
    ctx2d.arc(0, -s * 0.05, s * 0.42, Math.PI, 0);
    ctx2d.stroke();
    // Saucer
    ctx2d.shadowColor = icon.col2;
    ctx2d.shadowBlur = 10;
    ctx2d.fillStyle = icon.col1;
    ctx2d.beginPath();
    ctx2d.ellipse(0, s * 0.12, s * 0.62, s * 0.26, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.shadowBlur = 0;
    ctx2d.strokeStyle = icon.col2;
    ctx2d.lineWidth = Math.max(2.5, s * 0.08);
    ctx2d.stroke();
    ctx2d.fillStyle = icon.col2;
    for (var i = -1; i <= 1; i++) {
      ctx2d.beginPath();
      ctx2d.arc(i * s * 0.3, s * 0.16, s * 0.06, 0, Math.PI * 2);
      ctx2d.fill();
    }
    ctx2d.restore();
  }

  function drawWaveIcon(cx, cy, s, icon) {
    ctx2d.save();
    ctx2d.translate(cx, cy);
    ctx2d.shadowColor = icon.col2;
    ctx2d.shadowBlur = 12;
    ctx2d.fillStyle = icon.col1;
    ctx2d.beginPath();
    ctx2d.moveTo(s * 0.6, 0);
    ctx2d.lineTo(-s * 0.5, -s * 0.42);
    ctx2d.lineTo(-s * 0.22, 0);
    ctx2d.lineTo(-s * 0.5, s * 0.42);
    ctx2d.closePath();
    ctx2d.fill();
    ctx2d.shadowBlur = 0;
    ctx2d.strokeStyle = icon.col2;
    ctx2d.lineWidth = Math.max(2.5, s * 0.09);
    ctx2d.stroke();
    ctx2d.restore();
  }

  // ------------------------------------------------------------------
  // Particles
  // ------------------------------------------------------------------
  var parts = [];
  function fxClear() { parts.length = 0; }
  function fxSpawn(p) { parts.push(p); }

  function fxExplosion(wx, wy, color) {
    for (var i = 0; i < 30; i++) {
      var a = (i / 30) * Math.PI * 2;
      var sp = 180 + (i % 5) * 70;
      fxSpawn({
        x: wx, y: wy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.7 + (i % 3) * 0.15, age: 0, size: 5 + (i % 3) * 3,
        color: i % 4 === 0 ? '#ffffff' : color, kind: 'square', grav: 300
      });
    }
    fxSpawn({ x: wx, y: wy, life: 0.35, age: 0, size: 10, color: '#ffffff',
      kind: 'ring' });
  }

  function fxLandDust(wx, wy, dir) {
    for (var i = 0; i < 5; i++) {
      fxSpawn({
        x: wx, y: wy, vx: -80 - i * 25, vy: (20 + i * 14) * dir,
        life: 0.3, age: 0, size: 3.5, color: 'rgba(255,255,255,0.8)',
        kind: 'square', grav: 0
      });
    }
  }

  function fxTrail(wx, wy, color) {
    fxSpawn({
      x: wx, y: wy, vx: -60, vy: 0, life: 0.28, age: 0, size: 4.5,
      color: color, kind: 'square', grav: 0
    });
  }

  function fxCoin(wx, wy) {
    for (var i = 0; i < 12; i++) {
      var a = (i / 12) * Math.PI * 2;
      fxSpawn({
        x: wx, y: wy, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150,
        life: 0.5, age: 0, size: 4, color: '#ffd94a', kind: 'square', grav: 0
      });
    }
  }

  function fxCheckpoint(wx, wy) {
    fxSpawn({ x: wx, y: wy, life: 0.4, age: 0, size: 8, color: '#52ff7a',
      kind: 'ring' });
  }

  function fxFirework(wx, wy, color) {
    for (var i = 0; i < 24; i++) {
      var a = (i / 24) * Math.PI * 2;
      var sp = 130 + (i % 4) * 60;
      fxSpawn({
        x: wx, y: wy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.9, age: 0, size: 4, color: color, kind: 'square', grav: 160
      });
    }
  }

  function fxUpdate(dt) {
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      if (p.kind === 'square') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy -= (p.grav || 0) * dt;
      }
    }
  }

  function fxDraw() {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var k = 1 - p.age / p.life;
      ctx2d.save();
      ctx2d.globalAlpha = k;
      if (p.kind === 'ring') {
        ctx2d.strokeStyle = p.color;
        ctx2d.lineWidth = 5 * k + 1;
        ctx2d.beginPath();
        ctx2d.arc(sx(p.x), sy(p.y), p.size + (1 - k) * 90, 0, Math.PI * 2);
        ctx2d.stroke();
      } else {
        ctx2d.fillStyle = p.color;
        var s = p.size * (0.5 + k * 0.5) * (SCALE / 2.25);
        ctx2d.fillRect(sx(p.x) - s / 2, sy(p.y) - s / 2, s, s);
      }
      ctx2d.restore();
    }
  }

  // ------------------------------------------------------------------
  // HUD helpers
  // ------------------------------------------------------------------
  function drawProgressBar(pct, accent) {
    var bw = W * 0.36, bh = 12, x = (W - bw) / 2, y = 16;
    ctx2d.save();
    ctx2d.fillStyle = 'rgba(8,10,24,0.6)';
    roundRect(x - 2, y - 2, bw + 4, bh + 4, 8);
    ctx2d.fill();
    ctx2d.fillStyle = accent || '#52ff7a';
    if (pct > 0.003) {
      roundRect(x, y, Math.max(bh, bw * pct), bh, 6);
      ctx2d.fill();
    }
    ctx2d.restore();
    outlinedText(Math.floor(pct * 100) + '%', x + bw + 34, y + bh / 2 + 1, 17);
  }

  function wave(color) { return color; }

  var RENDER = {
    init: init,
    resize: resize,
    W: function () { return W; },
    H: function () { return H; },
    SCALE: function () { return SCALE; },
    setCam: setCam,
    getCam: function () { return { x: camX, y: camY }; },
    sx: sx, sy: sy,
    ctx: function () { return ctx2d; },
    zoneColors: zoneColors,
    hexRgb: hexRgb, rgbCss: rgbCss, lerpC: lerpC,
    roundRect: roundRect,
    outlinedText: outlinedText,
    drawBackground: drawBackground,
    drawGround: drawGround,
    drawObjects: drawObjects,
    drawPlayer: drawPlayer,
    drawCubeIcon: drawCubeIcon,
    drawShipIcon: drawShipIcon,
    drawBallIcon: drawBallIcon,
    drawUfoIcon: drawUfoIcon,
    drawWaveIcon: drawWaveIcon,
    drawProgressBar: drawProgressBar,
    beatPulse: beatPulse,
    fx: {
      clear: fxClear, explosion: fxExplosion, landDust: fxLandDust,
      trail: fxTrail, coin: fxCoin, checkpoint: fxCheckpoint,
      firework: fxFirework, update: fxUpdate, draw: fxDraw
    }
  };

  global.GD_RENDER = RENDER;
})(typeof window !== 'undefined' ? window : globalThis);
