/**
 * Spike step 3: verify @tensorflow/tfjs loads and runs under Pear runtime.
 * Run via: pear run scripts/spike-pear-test.js
 */
'use strict';

// Pear/bare uses bare-path, bare-fs (Node-style 'path'/'fs' aren't built-in)
const path = (typeof Bare !== 'undefined') ? require('bare-path') : require('path');
const fs   = (typeof Bare !== 'undefined') ? require('bare-fs')   : require('fs');

console.log('[pear-spike] starting');
console.log('[pear-spike] typeof Pear:', typeof Pear);
console.log('[pear-spike] typeof process:', typeof process);
console.log('[pear-spike] typeof Bare:', typeof Bare);

// Pear/Bare shim: tfjs auto-registers a Node platform via util.types,
// which Bare doesn't have. Trick tfjs into using its PlatformBrowser
// (pure JS, no util.types) by faking a minimal browser env.
if (typeof Bare !== 'undefined') {
  if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
  if (typeof globalThis.document === 'undefined') globalThis.document = {};
}

let tf;
try {
  tf = require('@tensorflow/tfjs');
  console.log('[pear-spike] tfjs required OK, version:', tf.version.tfjs);
  // Force CPU backend; webgl probe will fail otherwise (no real DOM).
  tf.setBackend('cpu');
} catch (e) {
  console.error('[pear-spike] FAIL require tfjs:', e.message);
  if (typeof Pear !== 'undefined') Pear.exit(1);
  if (typeof process !== 'undefined') process.exit(1);
}

// In Pear, __dirname is virtualized. Pear.config.dir gives the real fs path.
const ROOT = (typeof Pear !== 'undefined' && Pear.config && Pear.config.dir)
  ? Pear.config.dir
  : path.join(__dirname, '..');
const MODEL_DIR = path.join(ROOT, 'ai', 'models', 'dummy-spike');
console.log('[pear-spike] ROOT:', ROOT);
console.log('[pear-spike] MODEL_DIR:', MODEL_DIR);

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
      console.error('[pear-spike] model not found at', MODEL_DIR);
      console.error('[pear-spike] run "node scripts/spike-create-dummy-model.js" first');
      if (typeof Pear !== 'undefined') Pear.exit(2);
      return;
    }

    const t0 = Date.now();
    const model = await tf.loadLayersModel(makeFileIOHandler(MODEL_DIR));
    console.log(`[pear-spike] loaded in ${Date.now() - t0}ms`);

    const samples = [
      [0.1, 0.2, 0.1, 0.0, 0.1],
      [0.9, 0.8, 0.9, 0.9, 0.9],
      [0.5, 0.5, 0.5, 0.5, 0.5]
    ];
    for (const s of samples) {
      const t = Date.now();
      const input = tf.tensor2d([s]);
      const out = model.predict(input);
      const p = (await out.data())[0];
      input.dispose();
      out.dispose();
      console.log(`[pear-spike] features=${s} -> p=${p.toFixed(3)} (${Date.now() - t}ms)`);
    }

    // hot path benchmark
    const N = 500;
    const benchInput = tf.tensor2d([[0.5, 0.5, 0.5, 0.5, 0.5]]);
    const t1 = Date.now();
    for (let i = 0; i < N; i++) {
      const out = model.predict(benchInput);
      await out.data();
      out.dispose();
    }
    const totalMs = Date.now() - t1;
    benchInput.dispose();
    console.log(`[pear-spike] hot path: ${N} inferences in ${totalMs}ms (${(totalMs / N).toFixed(3)}ms/call)`);
    console.log('[pear-spike] OK');

    if (typeof Pear !== 'undefined') Pear.exit(0);
  } catch (e) {
    console.error('[pear-spike] FAIL:', e.stack || e.message);
    if (typeof Pear !== 'undefined') Pear.exit(1);
    if (typeof process !== 'undefined') process.exit(1);
  }
})();
