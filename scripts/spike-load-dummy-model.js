#!/usr/bin/env node
/**
 * Spike step 2: load the dummy model with PURE @tensorflow/tfjs (no native
 * deps) and run an inference. This simulates the runtime environment in
 * production / Pear sandbox.
 *
 * Reads: ai/models/dummy-spike/model.json
 */
'use strict';

const tf   = require('@tensorflow/tfjs'); // pure JS, no native bindings
const path = require('path');
const fs   = require('fs');

const MODEL_DIR  = path.join(__dirname, '..', 'ai', 'models', 'dummy-spike');
const MODEL_FILE = path.join(MODEL_DIR, 'model.json');

console.log('[spike-load] using @tensorflow/tfjs (pure JS, no native)');
console.log('[spike-load] tf version:', tf.version.tfjs);
console.log('[spike-load] tf backend:', tf.getBackend());

/**
 * Custom file-IO handler so we don't depend on the `file://` URL scheme,
 * which only ships in node-specific tfjs builds. Pure tfjs works in browsers,
 * so we wire up our own loader against the local filesystem.
 */
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
          // Convert Buffer slice to ArrayBuffer (no shared view of pool).
          weightBufs.push(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        }
      }
      // Concatenate all weight buffers
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
  if (!fs.existsSync(MODEL_FILE)) {
    console.error(`[spike-load] model file not found: ${MODEL_FILE}`);
    console.error('[spike-load] run scripts/spike-create-dummy-model.js first');
    process.exit(2);
  }

  console.log('[spike-load] loading model with custom file IO handler...');
  const t0 = Date.now();
  const model = await tf.loadLayersModel(makeFileIOHandler(MODEL_DIR));
  console.log(`[spike-load] loaded in ${Date.now() - t0}ms`);

  console.log('[spike-load] model summary:');
  model.summary();

  // Run a few inferences and time them
  const samples = [
    [0.1, 0.2, 0.1, 0.0, 0.1], // should be ~0
    [0.9, 0.8, 0.9, 0.9, 0.9], // should be ~1
    [0.5, 0.5, 0.5, 0.5, 0.5], // borderline
    [0.7, 0.6, 0.8, 0.5, 0.7],
    [0.3, 0.4, 0.2, 0.3, 0.3]
  ];

  console.log('[spike-load] running inferences:');
  for (const s of samples) {
    const t = Date.now();
    const input = tf.tensor2d([s]);
    const out = model.predict(input);
    const p = (await out.data())[0];
    const dt = Date.now() - t;
    input.dispose();
    out.dispose();
    console.log(`   features=${s} -> p=${p.toFixed(3)} (${dt}ms)`);
  }

  // Hot-path benchmark
  const N = 1000;
  const benchInput = tf.tensor2d([[0.5, 0.5, 0.5, 0.5, 0.5]]);
  const t1 = Date.now();
  for (let i = 0; i < N; i++) {
    const out = model.predict(benchInput);
    await out.data();
    out.dispose();
  }
  const totalMs = Date.now() - t1;
  benchInput.dispose();
  console.log(`[spike-load] hot path: ${N} inferences in ${totalMs}ms (${(totalMs / N).toFixed(3)}ms/call)`);

  console.log('[spike-load] OK');
})().catch(err => {
  console.error('[spike-load] FAIL:', err.stack || err);
  process.exit(1);
});
