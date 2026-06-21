// Sons courts synthétisés via WebAudio (aucun fichier asset nécessaire).
const Sound = (() => {
  let ctx = null;
  const ensure = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };

  function tone(freq, dur, type = 'sine', vol = 0.2, when = 0) {
    const c = ensure();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g);
    g.connect(c.destination);
    const t = c.currentTime + when;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  return {
    coin() { tone(880, 0.12, 'triangle', 0.18); tone(1320, 0.12, 'triangle', 0.12, 0.05); },
    select() { tone(440, 0.06, 'square', 0.1); },
    chest() { tone(180, 0.25, 'sawtooth', 0.18); tone(90, 0.4, 'sine', 0.18, 0.05); },
    stamp() { tone(120, 0.08, 'square', 0.25); },
    siren() {
      const c = ensure();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sawtooth';
      o.connect(g); g.connect(c.destination);
      const t = c.currentTime;
      g.gain.setValueAtTime(0.15, t);
      o.frequency.setValueAtTime(660, t);
      o.frequency.linearRampToValueAtTime(440, t + 0.25);
      o.frequency.linearRampToValueAtTime(660, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.start(t); o.stop(t + 0.62);
    },
    win() { tone(523, 0.12, 'triangle', 0.18); tone(659, 0.12, 'triangle', 0.18, 0.1); tone(784, 0.2, 'triangle', 0.18, 0.2); },
    lose() { tone(330, 0.15, 'sawtooth', 0.18); tone(220, 0.3, 'sawtooth', 0.18, 0.12); },
  };
})();
