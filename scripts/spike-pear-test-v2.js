/**
 * Spike: test tfjs model loading in Pear runtime with the biomesh-risk-v1 model.
 */
'use strict';

const path = (typeof Bare !== 'undefined') ? require('bare-path') : require('path');
const fs   = (typeof Bare !== 'undefined') ? require('bare-fs')   : require('fs');

console.log('[pear-spike-v2] starting');

if (typeof Bare !== 'undefined') {
  if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
  if (typeof globalThis.document === 'undefined') globalThis.document = {};
}

let tf;
try {
  tf = require('@tensorflow/tfjs');
  console.log('[pear-spike-v2] tfjs required OK, version:', tf.version.tfjs);
  tf.setBackend('cpu');
} catch (e) {
  console.error('[pear-spike-v2] FAIL require tfjs:', e.message);
  if (typeof Pear !== 'undefined') Pear.exit(1);
  process.exit(1);
}

const ROOT = (typeof Pear !== 'undefined' && Pear.config && Pear.config.dir)
  ? Pear.config.dir
  : path.join(__dirname, '..');
const MODEL_DIR = path.join(ROOT, 'ai', 'models', 'biomesh-risk-v1');
console.log('[pear-spike-v2] MODEL_DIR:', MODEL_DIR);

function makeFileIOHandler(modelDir) {
  return {
    async load() {
      const modelJson = JSON.parse(fs.readFileSync(path.join(modelDir, 'model.json'), 'utf8'));
      const weightSpecs = [];
      const weightBufs = [];
      for (const group of modelJson.weightsManifest) {
        for (const spec of group.weights) weightSpecs.push(spec);
        for (const file of group.paths) {
          const buf = fs.readFileSync(path.join(modelDir, file));
          weightBufs.push(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        }
      }
      const total = weightBufs.reduce((s, b) => s + b.byteLength, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const b of weightBufs) {
        merged.set(new Uint8Array(b), off);
        off += b.byteLength;
      }
      return {
        modelTopology: modelJson.modelTopology,
        weightSpecs,
        weightData: merged.buffer,
        format: modelJson.format,
        generatedBy: modelJson.generatedBy,
        convertedBy: modelJson.convertedBy
      };
    }
  };
}

(async () => {
  try {
    if (!fs.existsSync(path.join(MODEL_DIR, 'model.json'))) {
      console.error('[pear-spike-v2] model not found at', MODEL_DIR);
      console.error('[pear-spike-v2] run "npm run train" first');
      if (typeof Pear !== 'undefined') Pear.exit(2);
      return;
    }

    const t0 = Date.now();
    const model = await tf.loadLayersModel(makeFileIOHandler(MODEL_DIR));
    console.log(`[pear-spike-v2] loaded in ${Date.now() - t0}ms`);

    model.summary();

    const metaPath = path.join(MODEL_DIR, 'metadata.json');
    let meta = null;
    if (fs.existsSync(metaPath)) {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      console.log('[pear-spike-v2] scaler mean:', meta.scaler.mean);
      console.log('[pear-spike-v2] scaler std:', meta.scaler.std);
    }

    function standardize(reading, scaler) {
      return [
        (reading.temperature - scaler.mean[0]) / scaler.std[0],
        (reading.humidity - scaler.mean[1]) / scaler.std[1],
        (reading.wind - scaler.mean[2]) / scaler.std[2],
        (reading.light - scaler.mean[3]) / scaler.std[3],
        (reading.airQuality - scaler.mean[4]) / scaler.std[4]
      ];
    }

    const readings = [
      { name: 'heatwave', reading: { temperature: 42, humidity: 18, wind: 8, light: 950, airQuality: 80 }, expect: 'high' },
      { name: 'freeze', reading: { temperature: -5, humidity: 70, wind: 12, light: 200, airQuality: 30 }, expect: 'high' },
      { name: 'calm-day', reading: { temperature: 22, humidity: 55, wind: 10, light: 600, airQuality: 35 }, expect: 'low' },
      { name: 'windstorm', reading: { temperature: 18, humidity: 60, wind: 65, light: 400, airQuality: 40 }, expect: 'high' },
      { name: 'pollution', reading: { temperature: 25, humidity: 50, wind: 5, light: 700, airQuality: 88 }, expect: 'high' }
    ];

    console.log('[pear-spike-v2] testing inferences:');
    let pass = 0;
    for (const c of readings) {
      const features = standardize(c.reading, meta.scaler);
      const input = tf.tensor2d([features]);
      const out = model.predict(input);
      const probs = await out.data();
      const probability = probs[0];
      const risk = probability >= 0.5 ? 'high' : 'low';
      input.dispose();
      out.dispose();
      const ok = risk === c.expect;
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + c.name.padEnd(12) + ' expected=' + c.expect + ' got=' + risk + ' p=' + probability.toFixed(3));
      if (ok) pass++;
    }
    console.log('[pear-spike-v2] ' + pass + '/' + readings.length + ' passed');

    const N = 100;
    const scaler = meta.scaler;
    const benchFeatures = [standardize({ temperature: 22, humidity: 55, wind: 10, light: 600, airQuality: 35 }, scaler)];
    const benchInput = tf.tensor2d(benchFeatures);
    const t1 = Date.now();
    for (let i = 0; i < N; i++) {
      const out = model.predict(benchInput);
      await out.data();
      out.dispose();
    }
    const totalMs = Date.now() - t1;
    benchInput.dispose();
    console.log(`[pear-spike-v2] hot path: ${N} inferences in ${totalMs}ms (${(totalMs / N).toFixed(3)}ms/call)`);

    console.log('[pear-spike-v2] OK');
    if (typeof Pear !== 'undefined') Pear.exit(0);
  } catch (e) {
    console.error('[pear-spike-v2] FAIL:', e.stack || e.message);
    if (typeof Pear !== 'undefined') Pear.exit(1);
  }
})();