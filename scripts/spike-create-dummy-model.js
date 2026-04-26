#!/usr/bin/env node
/**
 * Spike step 1: create a tiny dummy tfjs model and persist to disk.
 * Verifies the save path works under plain Node (with tfjs-node backend).
 *
 * Output: ai/models/dummy-spike/model.json + weights
 */
'use strict';

// Use pure tfjs for the spike. tfjs-node has incompat with Node v24
// (removed util.isNullOrUndefined). For real training we'll re-evaluate;
// the spike's job is to verify load+infer in the runtime path.
const tf = require('@tensorflow/tfjs');
console.log('[spike-create] using @tensorflow/tfjs (pure)');

const path = require('path');
const fs   = require('fs');

const OUT_DIR = path.join(__dirname, '..', 'ai', 'models', 'dummy-spike');

/**
 * Custom save handler for pure tfjs. Writes:
 *   {OUT_DIR}/model.json
 *   {OUT_DIR}/weights.bin
 */
function makeFileSaveHandler(outDir) {
  return {
    async save(modelArtifacts) {
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const weightsPath = 'weights.bin';
      const weightData = modelArtifacts.weightData;
      fs.writeFileSync(path.join(outDir, weightsPath), Buffer.from(weightData));
      const modelJson = {
        modelTopology: modelArtifacts.modelTopology,
        format: modelArtifacts.format,
        generatedBy: modelArtifacts.generatedBy,
        convertedBy: modelArtifacts.convertedBy,
        weightsManifest: [
          {
            paths: [weightsPath],
            weights: modelArtifacts.weightSpecs
          }
        ]
      };
      fs.writeFileSync(path.join(outDir, 'model.json'), JSON.stringify(modelJson));
      return {
        modelArtifactsInfo: {
          dateSaved: new Date(),
          modelTopologyType: 'JSON'
        }
      };
    }
  };
}

(async () => {
  const model = tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [5], units: 16, activation: 'relu' }),
      tf.layers.dense({ units: 8, activation: 'relu' }),
      tf.layers.dense({ units: 1, activation: 'sigmoid' })
    ]
  });

  model.compile({
    optimizer: tf.train.adam(1e-3),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy']
  });

  // Train one fake step so weights are non-zero and predictions are meaningful
  const xs = tf.randomUniform([200, 5]);
  // Generate label: 1 if mean > 0.5, else 0
  const ysData = [];
  const xsData = await xs.array();
  for (const row of xsData) {
    const mean = row.reduce((a, b) => a + b, 0) / row.length;
    ysData.push(mean > 0.5 ? 1 : 0);
  }
  const ys = tf.tensor1d(ysData, 'float32');

  console.log('[spike-create] training 5 epochs on synthetic data...');
  await model.fit(xs, ys, { epochs: 5, batchSize: 32, verbose: 0 });

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  await model.save(makeFileSaveHandler(OUT_DIR));
  console.log(`[spike-create] saved to ${OUT_DIR}`);
  console.log('[spike-create] files:');
  for (const f of fs.readdirSync(OUT_DIR)) {
    const s = fs.statSync(path.join(OUT_DIR, f));
    console.log(`   ${f} (${s.size} bytes)`);
  }

  xs.dispose(); ys.dispose();
  console.log('[spike-create] OK');
})().catch(err => {
  console.error('[spike-create] FAIL:', err);
  process.exit(1);
});
