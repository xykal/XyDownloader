/* XyDownloader — encoder MP3 di Web Worker (lamejs, LGPL) */
importScripts('vendor/lame/lame.min.js');

function floatTo16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

self.onmessage = (e) => {
  try {
    const { channels, sampleRate, kbps } = e.data;
    const numCh = Math.min(2, channels.length);
    const encoder = new lamejs.Mp3Encoder(numCh, sampleRate, kbps);
    const left = floatTo16(channels[0]);
    const right = numCh > 1 ? floatTo16(channels[1]) : null;
    const block = 1152;
    const out = [];
    let lastReport = 0;
    for (let i = 0; i < left.length; i += block) {
      const l = left.subarray(i, i + block);
      const buf = right ? encoder.encodeBuffer(l, right.subarray(i, i + block)) : encoder.encodeBuffer(l);
      if (buf.length) out.push(new Uint8Array(buf));
      if (i - lastReport > sampleRate * 5) {
        lastReport = i;
        self.postMessage({ progress: i / left.length });
      }
    }
    const end = encoder.flush();
    if (end.length) out.push(new Uint8Array(end));
    self.postMessage({ done: true, blob: new Blob(out, { type: 'audio/mpeg' }) });
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};
