/* ============================================================
 * 逃离遵化益众 - WebAudio 纯音乐合成(无外部音频文件)
 * 类型:morning 晨光钢琴 / night 夜雾氛围 / star 星夜电钢 / none 关闭
 * ============================================================ */
'use strict';

const AudioMgr = (function () {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let timer = null;
  let timer2 = null;
  let nextT = 0;
  let step = 0;
  let cur = 'none';
  let vol = 0.7;
  let sfxOn = true;
  let started = false;
  let pads = [];

  function midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = vol;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.8;
      musicGain.connect(master);
    }
    if (ctx.state === 'suspended') { ctx.resume(); }
    return ctx;
  }

  function note(freq, t0, dur, type, gain, dest) {
    const c = ensure();
    if (!c) return;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest || master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  /* 钢琴音色:基音+两个泛音 */
  function piano(m, t0, dur, gain, dest) {
    const f = midi(m);
    note(f, t0, dur, 'sine', gain, dest);
    note(f * 2, t0, dur * 0.65, 'sine', gain * 0.35, dest);
    note(f * 3, t0, dur * 0.35, 'sine', gain * 0.12, dest);
  }

  /* ---------- 音效 ---------- */
  function sfx(kind) {
    if (!sfxOn) return;
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + 0.01;
    if (kind === 'tap') { note(midi(84), t, 0.06, 'square', 0.035, master); }
    else if (kind === 'open') { note(midi(76), t, 0.07, 'sine', 0.05, master); note(midi(81), t + 0.07, 0.09, 'sine', 0.05, master); }
    else if (kind === 'move') { note(midi(72), t, 0.08, 'triangle', 0.06, master); note(midi(67), t + 0.07, 0.09, 'triangle', 0.05, master); }
    else if (kind === 'event') { piano(62, t, 0.6, 0.07, master); piano(58, t + 0.12, 0.8, 0.06, master); }
    else if (kind === 'win') {
      [72, 76, 79, 84, 88].forEach(function (n, i) { piano(n, t + i * 0.13, 0.4, 0.06, master); });
    }
    else if (kind === 'lose') {
      [64, 60, 57, 52].forEach(function (n, i) { note(midi(n), t + i * 0.18, 0.5, 'sawtooth', 0.04, master); });
    }
  }

  /* ---------- 纯音乐曲库 ---------- */
  const SONGS = {
    morning: {
      bpm: 84, gain: 0.15, bassGain: 0.09,
      melody: [60, 64, 67, 72, 67, 64, 60, 64, 67, 72, 76, 72, 67, 64, 62, 60, 57, 60, 64, 67, 72, 76, 79, 76],
      bass: [36, 36, 41, 41, 33, 33, 38, 38, 36, 36, 41, 41, 45, 45, 43, 43]
    },
    night: { gain: 0.05, hits: [69, 72, 76, 81] },
    star: {
      bpm: 72, gain: 0.09, bassGain: 0.06,
      melody: [64, 67, 71, 76, 74, 71, 67, 64, 62, 66, 69, 74, 71, 69, 66, 62, 60, 64, 67, 72, 71, 67, 64, 60],
      bass: [40, 40, 43, 43, 45, 45, 38, 38, 40, 40, 45, 45, 47, 47, 43, 43]
    }
  };

  function startMusic(type) {
    stopMusic();
    cur = type || 'none';
    if (cur === 'none') return;
    const c = ensure();
    if (!c) return;
    if (cur === 'night') {
      // 双振荡器低频铺底
      const freqs = [55, 55.6, 82.4];   // A1 微失谐 + E2
      pads = [];
      freqs.forEach(function (f) {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = c.createGain();
        g.gain.value = SONGS.night.gain;
        o.connect(g);
        g.connect(musicGain);
        o.start();
        pads.push({ o: o, g: g });
      });
      // 稀疏高音
      timer2 = setInterval(function () {
        if (Math.random() < 0.55) {
          const n = SONGS.night.hits[Math.floor(Math.random() * SONGS.night.hits.length)];
          piano(n, ctx.currentTime + 0.05, 2.4, 0.045, musicGain);
        }
      }, 2400);
    } else {
      const s = SONGS[cur];
      const spb = 60 / s.bpm / 2;
      nextT = ctx.currentTime + 0.1;
      step = 0;
      timer = setInterval(function () {
        if (!ctx) return;
        while (nextT < ctx.currentTime + 0.45) {
          const mi = step % s.melody.length;
          piano(s.melody[mi], nextT, spb * 2.6, s.gain, musicGain);
          if (step % 2 === 0) {
            const bi = Math.floor(step / 2) % s.bass.length;
            note(midi(s.bass[bi] - 12), nextT, spb * 5, 'sine', s.bassGain, musicGain);
          }
          nextT += spb;
          step++;
        }
      }, 220);
    }
  }

  function stopMusic() {
    if (timer) { clearInterval(timer); timer = null; }
    if (timer2) { clearInterval(timer2); timer2 = null; }
    for (let i = 0; i < pads.length; i++) {
      try { pads[i].o.stop(); } catch (e) {}
    }
    pads = [];
    cur = 'none';
  }

  function setVolume(v) {
    vol = Math.max(0, Math.min(1, v));
    if (master) master.gain.value = vol;
  }

  function setSfx(on) { sfxOn = on; }

  function boot() {
    if (started) return;
    started = true;
    ensure();
  }

  return { boot: boot, sfx: sfx, startMusic: startMusic, stopMusic: stopMusic, setVolume: setVolume, setSfx: setSfx };
})();
