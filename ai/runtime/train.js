'use strict';

// Node 24 removes util.isNullOrUndefined, breaking tfjs-node. Use pure tfjs.
const tf = require('@tensorflow/tfjs');
const backendType = 'tfjs';

console.log('[train] using pure tfjs (tfjs-node incompatible with Node 24)');

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CSV_PATH = path.join(ROOT, 'ai', 'data', 'biomesh-train.csv');
const MODEL_DIR = path.join(ROOT, 'ai', 'models', 'biomesh-risk-v1');
const META_PATH = path.join(MODEL_DIR, 'metadata.json');

async function train() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error('[train] dataset not found. Run "npm run dataset" first.');
    process.exit(1);
  }

  console.log('[train] loading dataset from', CSV_PATH);
  const lines = fs.readFileSync(CSV_PATH, 'utf8').trim().split('\n');
  lines.shift();

  const xs = [], ys = [];
  for (const line of lines) {
    const p = line.split(',');
    if (p.length < 6) continue;
    xs.push(p.slice(0, 5).map(Number));
    ys.push(p[5].trim() === 'high' ? 1 : 0);
  }

  console.log(`[train] loaded ${xs.length} samples`);

  const xsT = tf.tensor2d(xs);
  const mean = xsT.mean(0);
  const variance = xsT.sub(mean).square().mean(0);
  const std = variance.sqrt().add(1e-8);
  const meanArr = Array.from(mean.dataSync());
  const stdArr = Array.from(std.dataSync());

  console.log('[train] scaler mean:', meanArr.map(n => n.toFixed(2)));
  console.log('[train] scaler std:', stdArr.map(n => n.toFixed(2)));

  const xsNorm = xsT.sub(mean).div(std);
  const ysT = tf.tensor1d(ys, 'float32');

  const total = ys.length;
  const pos = ys.reduce((a, b) => a + b, 0);
  const neg = total - pos;
  const classWeight = { 0: total / (2 * neg), 1: total / (2 * pos) };
  console.log(`[train] class imbalance: low=${neg}, high=${pos}, weights:`, classWeight);

  const model = tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [5], units: 16, activation: 'relu' }),
      tf.layers.dense({ units: 8, activation: 'relu' }),
      tf.layers.dense({ units: 1, activation: 'sigmoid' })
    ]
  });

  model.compile({
    optimizer: tf.train.adam(5e-4),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy']
  });

  console.log('[train] training for 80 epochs...');
  await model.fit(xsNorm, ysT, {
    epochs: 80,
    batchSize: 64,
    validationSplit: 0.15,
    classWeight,
    verbose: 0,
    callbacks: {
      onEpochEnd(epoch, logs) {
        if ((epoch + 1) % 10 === 0) {
          console.log(`epoch ${epoch + 1}/80  loss=${logs.loss.toFixed(4)}  val_acc=${(logs.val_acc ?? 0).toFixed(4)}`);
        }
      }
    }
  });

  xsT.dispose();
  xsNorm.dispose();
  ysT.dispose();

  const testInput = tf.tensor2d([[
    (40 - meanArr[0]) / stdArr[0],
    (20 - meanArr[1]) / stdArr[1],
    (10 - meanArr[2]) / stdArr[2],
    (900 - meanArr[3]) / stdArr[3],
    (80 - meanArr[4]) / stdArr[4]
  ]]);
  const pred = model.predict(testInput);
  const prob = (await pred.data())[0];
  console.log(`[train] test prediction (high risk): probability=${prob.toFixed(3)}`);
  testInput.dispose();
  pred.dispose();

  fs.mkdirSync(MODEL_DIR, { recursive: true });

  function makeFileSaveHandler(outDir) {
    return {
      async save(modelArtifacts) {
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const weightsPath = 'weights.bin';
        fs.writeFileSync(path.join(outDir, weightsPath), Buffer.from(modelArtifacts.weightData));
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
        return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
      }
    };
  }

  await model.save(makeFileSaveHandler(MODEL_DIR));

  const metadata = {
    id: 'biomesh-risk-v1',
    version: '1.0.0',
    trainedAt: new Date().toISOString(),
    backend: backendType,
    scaler: { mean: meanArr, std: stdArr },
    labels: ['low', 'high'],
    threshold: 0.5,
    classWeight
  };

  fs.writeFileSync(META_PATH, JSON.stringify(metadata, null, 2));
  console.log('[train] saved model + metadata to', MODEL_DIR);
  console.log('[train] DONE');
}

train().catch(e => {
  console.error('[train] FAILED:', e);
  process.exit(1);
});