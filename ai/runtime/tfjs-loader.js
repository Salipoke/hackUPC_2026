'use strict';

const path = (typeof Bare !== 'undefined') ? require('bare-path') : require('path');
const fs   = (typeof Bare !== 'undefined') ? require('bare-fs')   : require('fs');

const ROOT = (typeof Pear !== 'undefined' && Pear.config && Pear.config.dir)
  ? Pear.config.dir
  : path.join(__dirname, '../..');

const MODEL_DIR = path.join(ROOT, 'ai', 'models', 'biomesh-risk-v1');
const META_PATH = path.join(MODEL_DIR, 'metadata.json');

let tf = null;
let model = null;
let metadata = null;

function shim() {
  if (typeof Bare !== 'undefined') {
    if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
    if (typeof globalThis.document === 'undefined') globalThis.document = {};
  }
}

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

async function load() {
  if (model) return;

  shim();

  if (!tf) tf = require('@tensorflow/tfjs');
  tf.setBackend('cpu');

  if (!fs.existsSync(path.join(MODEL_DIR, 'model.json'))) {
    throw new Error(`Model not found at ${MODEL_DIR}. Run 'npm run train' first.`);
  }

  metadata = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
  model = await tf.loadLayersModel(makeFileIOHandler(MODEL_DIR));
}

async function run(features) {
  if (!model) await load();

  const input = tf.tensor2d([features]);
  const out = model.predict(input);
  const probs = await out.data();
  input.dispose();
  out.dispose();

  const probability = probs[0];
  const labels = metadata.labels || ['low', 'high'];
  const threshold = metadata.threshold || 0.5;

  return {
    probability,
    predictedClass: probability >= threshold ? 1 : 0,
    label: probability >= threshold ? labels[1] : labels[0]
  };
}

function available() {
  return model !== null;
}

function getMetadata() {
  return metadata;
}

module.exports = { load, run, available, getMetadata };