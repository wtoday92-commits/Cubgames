// Фоновый эмбиент «лесная река» — синтез через Web Audio, без внешних файлов.
// Мягкий шум воды + журчание с медленным «течением». Включается по кнопке
// (браузеры разрешают звук только после действия пользователя).

let ctx = null;
let master = null;
let on = false;

export function isOn() { return on; }

function noiseBuffer(seconds, brown) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * white) / 1.02; d[i] = last * 3.2; }
    else d[i] = white;
  }
  return buf;
}

function build() {
  master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);

  // низкий ровный гул воды
  const s1 = ctx.createBufferSource(); s1.buffer = noiseBuffer(4, true); s1.loop = true;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 640; lp.Q.value = 0.7;
  s1.connect(hp).connect(lp).connect(master); s1.start();

  // журчание/переливы
  const s2 = ctx.createBufferSource(); s2.buffer = noiseBuffer(4, false); s2.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.9;
  const g2 = ctx.createGain(); g2.gain.value = 0.22;
  s2.connect(bp).connect(g2).connect(master); s2.start();

  // медленное «течение» — LFO на срез фильтра и на громкость журчания
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
  const lfoG = ctx.createGain(); lfoG.gain.value = 160;
  lfo.connect(lfoG).connect(lp.frequency); lfo.start();

  const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.15;
  const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.1;
  lfo2.connect(lfo2G).connect(g2.gain); lfo2.start();
}

export function start() {
  try {
    if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); build(); }
    ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0.16, ctx.currentTime, 0.8);
    on = true;
  } catch (_) { on = false; }
  return on;
}

export function stop() {
  if (ctx && master) master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
  on = false;
  return on;
}

export function toggle() { return on ? stop() : start(); }
