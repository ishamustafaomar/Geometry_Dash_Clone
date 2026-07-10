/*
 * Geometric Rush — WebAudio engine.
 *
 * Everything is synthesized at runtime: four original electro tracks (one
 * per level plus the menu) written as step-sequencer patterns, and all sound
 * effects. No samples, no external files.
 */
(function (global) {
  'use strict';

  var ctx = null;
  var master, musicGain, sfxGain, delayBus;
  var enabled = { music: true, sfx: true };

  function ensureCtx() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    master.connect(comp);
    comp.connect(ctx.destination);

    musicGain = ctx.createGain();
    musicGain.gain.value = enabled.music ? 0.8 : 0;
    musicGain.connect(master);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = enabled.sfx ? 0.9 : 0;
    sfxGain.connect(master);

    // Small ping-pong-ish echo for leads.
    delayBus = ctx.createGain();
    var d = ctx.createDelay(0.6);
    d.delayTime.value = 0.23;
    var fb = ctx.createGain();
    fb.gain.value = 0.28;
    var wet = ctx.createGain();
    wet.gain.value = 0.25;
    delayBus.connect(d);
    d.connect(fb);
    fb.connect(d);
    d.connect(wet);
    wet.connect(musicGain);

    noiseBuf = makeNoise();
    return ctx;
  }

  var noiseBuf = null;
  function makeNoise() {
    var len = ctx.sampleRate * 1.2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    // Deterministic LCG noise — no Math.random needed.
    var seed = 22222;
    for (var i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 2147483648 - 1);
    }
    return buf;
  }

  function unlock() {
    var c = ensureCtx();
    if (c && c.state === 'suspended') c.resume();
  }

  // ------------------------------------------------------------------
  // Instruments
  // ------------------------------------------------------------------
  function kick(t) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(musicGain);
    o.start(t); o.stop(t + 0.25);
  }

  function hat(t, open) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 1.7;
    var f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7000;
    var g = ctx.createGain();
    var dur = open ? 0.14 : 0.04;
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(musicGain);
    src.start(t); src.stop(t + dur + 0.02);
  }

  function snare(t) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    src.connect(f); f.connect(g); g.connect(musicGain);
    src.start(t); src.stop(t + 0.16);
    var o = ctx.createOscillator(), g2 = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = 190;
    g2.gain.setValueAtTime(0.25, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g2); g2.connect(musicGain);
    o.start(t); o.stop(t + 0.1);
  }

  function bass(t, freq, len) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(700, t);
    f.frequency.exponentialRampToValueAtTime(220, t + len);
    o.type = 'sawtooth';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.24, t + 0.01);
    g.gain.setValueAtTime(0.24, t + Math.max(0.01, len - 0.04));
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(f); f.connect(g); g.connect(musicGain);
    o.start(t); o.stop(t + len + 0.02);
  }

  function lead(t, freq, len, level) {
    level = level || 0.13;
    for (var i = 0; i < 2; i++) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 2600;
      o.type = 'square';
      o.frequency.value = freq * (i === 0 ? 1.0008 : 0.9992);
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(level, t + 0.012);
      g.gain.setValueAtTime(level, t + Math.max(0.012, len - 0.05));
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(f); f.connect(g);
      g.connect(musicGain);
      if (i === 0) g.connect(delayBus);
      o.start(t); o.stop(t + len + 0.02);
    }
  }

  function pad(t, freqs, len) {
    for (var i = 0; i < freqs.length; i++) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freqs[i];
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.07, t + len * 0.35);
      g.gain.linearRampToValueAtTime(0.001, t + len);
      o.connect(g); g.connect(musicGain);
      o.start(t); o.stop(t + len + 0.05);
    }
  }

  // ------------------------------------------------------------------
  // Original compositions
  //
  // Patterns are step arrays; melodic entries are semitone offsets from the
  // track root (null = rest). 16 steps per bar.
  // ------------------------------------------------------------------
  var _ = null;
  var TRACKS = [
    { // 0 — "Prism Runner": bright, driving, A-minor pentatonic.
      root: 110, bpm: 124.63,
      kick:  [1,_,_,_, 1,_,_,_, 1,_,_,_, 1,_,_,_],
      hat:   [_,_,1,_, _,_,1,_, _,_,1,_, _,_,1,2],
      snare: [_,_,_,_, 1,_,_,_, _,_,_,_, 1,_,_,_],
      // i — VI — VII — v over four bars
      bassNotes: [0, 0, 8, 8, 10, 10, 7, 7],
      bassSteps: [1,_,1,_, 1,_,1,_, 1,_,1,_, 1,_,1,_],
      melody: [
        12,_,15,_, 17,_,15,12, _,_,10,_, 12,_,_,_,
        15,_,17,_, 19,_,17,15, _,_,12,_, 10,_,_,_,
        12,_,15,_, 17,_,15,12, _,_,10,_, 7,_,_,_,
        10,_,12,_, 15,_,12,10, _,_,7,_, _,_,_,_
      ],
      melLen: 0.22
    },
    { // 1 — "Neon Circuit": moodier D-minor, syncopated.
      root: 146.83, bpm: 140,
      kick:  [1,_,_,_, 1,_,_,_, 1,_,_,1, 1,_,_,_],
      hat:   [_,1,1,1, _,1,1,1, _,1,1,1, _,1,1,1],
      snare: [_,_,_,_, 1,_,_,_, _,_,_,_, 1,_,_,1],
      bassNotes: [0, 0, 0, 0, 5, 5, 3, 7],
      bassSteps: [1,_,1,1, _,1,_,1, 1,_,1,1, _,1,_,_],
      melody: [
        _,_,12,_, 10,_,_,_, 8,_,10,_, 12,_,10,8,
        _,_,7,_, 8,_,_,_, 10,_,8,_, 7,_,5,3,
        _,_,12,_, 10,_,_,_, 8,_,10,_, 12,_,15,_,
        14,_,12,_, 10,_,8,_, 7,_,_,_, _,_,_,_
      ],
      melLen: 0.18
    },
    { // 2 — "Hyper Drift": aggressive E-minor 16th arps.
      root: 164.81, bpm: 150,
      kick:  [1,_,_,_, 1,_,_,_, 1,_,_,_, 1,_,1,_],
      hat:   [1,1,2,1, 1,1,2,1, 1,1,2,1, 1,1,2,1],
      snare: [_,_,_,_, 1,_,_,_, _,_,_,_, 1,_,_,_],
      bassNotes: [0, 12, 0, 12, 8, 20, 10, 22],
      bassSteps: [1,1,_,1, 1,_,1,1, _,1,1,_, 1,1,_,1],
      melody: [
        12,15,19,15, 12,15,19,15, 12,15,19,15, 12,15,19,24,
        8,12,15,12, 8,12,15,12, 10,14,17,14, 10,14,17,22,
        12,15,19,15, 12,15,19,15, 12,15,19,15, 12,15,19,24,
        14,17,22,17, 14,17,22,17, 12,15,19,15, 10,14,17,14
      ],
      melLen: 0.12
    },
    { // 3 — menu: calm C-major pads with a sparse sparkle.
      root: 130.81, bpm: 100,
      kick:  [_,_,_,_, _,_,_,_, _,_,_,_, _,_,_,_],
      hat:   [_,_,_,_, _,_,_,_, _,_,_,_, _,_,_,_],
      snare: [_,_,_,_, _,_,_,_, _,_,_,_, _,_,_,_],
      bassNotes: [0, 9, 5, 7],
      bassSteps: [1,_,_,_, _,_,_,_, _,_,_,_, _,_,_,_],
      melody: [
        _,_,_,_, 16,_,_,_, _,_,19,_, _,_,_,_,
        _,_,12,_, _,_,_,_, 16,_,_,_, _,_,_,_,
        _,_,_,_, 21,_,_,_, _,_,19,_, _,_,16,_,
        _,_,12,_, _,_,14,_, _,_,_,_, _,_,_,_
      ],
      melLen: 0.5,
      pads: true
    }
  ];

  function noteFreq(root, semi) {
    return root * Math.pow(2, semi / 12);
  }

  // ------------------------------------------------------------------
  // Sequencer
  // ------------------------------------------------------------------
  var seq = {
    playing: false, trackId: -1, step: 0, nextTime: 0, timer: null,
    startTime: 0
  };

  function stepDur(track) { return 60 / track.bpm / 4; }

  function scheduleStep(track, step, t) {
    var s16 = step % 16;
    var bar = Math.floor(step / 16);
    if (track.kick[s16]) kick(t);
    if (track.hat[s16]) hat(t, track.hat[s16] === 2);
    if (track.snare[s16]) snare(t);
    if (track.bassSteps[s16]) {
      var bn = track.bassNotes[(bar * 2 + (s16 >= 8 ? 1 : 0)) % track.bassNotes.length];
      bass(t, noteFreq(track.root, bn - 12), stepDur(track) * 1.9);
    }
    var mel = track.melody[step % track.melody.length];
    if (mel !== null && mel !== undefined) {
      lead(t, noteFreq(track.root, mel), track.melLen, track.pads ? 0.09 : 0.13);
    }
    if (track.pads && s16 === 0) {
      var pr = track.bassNotes[bar % track.bassNotes.length];
      pad(t, [noteFreq(track.root, pr), noteFreq(track.root, pr + 4),
        noteFreq(track.root, pr + 7)], stepDur(track) * 16);
    }
  }

  function pump() {
    if (!seq.playing) return;
    var track = TRACKS[seq.trackId];
    var ahead = ctx.currentTime + 0.14;
    while (seq.nextTime < ahead) {
      scheduleStep(track, seq.step, seq.nextTime);
      seq.step++;
      seq.nextTime += stepDur(track);
    }
  }

  function playTrack(id) {
    if (!ensureCtx()) return;
    stopMusic();
    seq.playing = true;
    seq.trackId = id;
    seq.step = 0;
    seq.nextTime = ctx.currentTime + 0.06;
    seq.startTime = seq.nextTime;
    seq.timer = setInterval(pump, 25);
    pump();
  }

  function stopMusic() {
    seq.playing = false;
    if (seq.timer) { clearInterval(seq.timer); seq.timer = null; }
  }

  // Current position in beats (for renderer pulse effects).
  function beatPhase() {
    if (!ctx || !seq.playing) return 0;
    var track = TRACKS[seq.trackId];
    var beats = (ctx.currentTime - seq.startTime) / (60 / track.bpm);
    return Math.max(0, beats);
  }

  // ------------------------------------------------------------------
  // SFX
  // ------------------------------------------------------------------
  function sfxDeath() {
    if (!ensureCtx() || !enabled.sfx) return;
    var t = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3400, t);
    f.frequency.exponentialRampToValueAtTime(240, t + 0.34);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
    src.connect(f); f.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + 0.4);
    var o = ctx.createOscillator(), g2 = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.3);
    g2.gain.setValueAtTime(0.2, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g2); g2.connect(sfxGain);
    o.start(t); o.stop(t + 0.32);
  }

  function blip(freq, t, dur, level, type) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function sfxCoin() {
    if (!ensureCtx() || !enabled.sfx) return;
    var t = ctx.currentTime;
    blip(988, t, 0.09, 0.25);
    blip(1319, t + 0.07, 0.22, 0.25);
  }

  function sfxWin() {
    if (!ensureCtx() || !enabled.sfx) return;
    var t = ctx.currentTime;
    var notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    for (var i = 0; i < notes.length; i++) {
      blip(notes[i], t + i * 0.09, 0.3, 0.22, 'triangle');
    }
  }

  function sfxCheckpoint() {
    if (!ensureCtx() || !enabled.sfx) return;
    var t = ctx.currentTime;
    blip(660, t, 0.1, 0.18, 'triangle');
    blip(880, t + 0.06, 0.14, 0.18, 'triangle');
  }

  function sfxClick() {
    if (!ensureCtx() || !enabled.sfx) return;
    blip(700, ctx.currentTime, 0.05, 0.14, 'square');
  }

  function setEnabled(kind, on) {
    enabled[kind] = on;
    if (!ctx) return;
    if (kind === 'music') musicGain.gain.value = on ? 0.8 : 0;
    if (kind === 'sfx') sfxGain.gain.value = on ? 0.9 : 0;
  }

  var AUDIO = {
    unlock: unlock,
    playTrack: playTrack,
    stopMusic: stopMusic,
    beatPhase: beatPhase,
    sfxDeath: sfxDeath,
    sfxCoin: sfxCoin,
    sfxWin: sfxWin,
    sfxCheckpoint: sfxCheckpoint,
    sfxClick: sfxClick,
    setEnabled: setEnabled,
    isEnabled: function (k) { return enabled[k]; },
    MENU_TRACK: 3
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AUDIO;
  else global.GD_AUDIO = AUDIO;
})(typeof window !== 'undefined' ? window : globalThis);
