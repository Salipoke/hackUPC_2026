/**
 * BioMeshP2P EdgeAI Decision Module (V2)
 *
 * Evaluation pipeline:
 *   1. Try tfjs model (ai/runtime/tfjs-loader.js)
 *   2. If load fails, fall back to threshold heuristic (ai/decision-threshold.js)
 *
 * Public API:
 *   evaluate(reading: SensorReading, history?: SensorReading[]) -> Promise<Verdict>
 *
 * SensorReading shape (see helper.js):
 *   { peerId, timestamp, lat, lng, temperature, humidity, wind, light, airQuality, ... }
 *
 * Verdict shape:
 *   {
 *     risk: 'low' | 'high',
 *     score: number,           // 0..1, confidence of high risk
 *     reasons: string[],     // human-readable triggers
 *     model: string,         // model id
 *     version: string        // model version
 *   }
 */

const loader = require('./runtime/tfjs-loader');
const threshold = require('./decision-threshold');
const featurePipeline = require('./runtime/feature-pipeline');

const MODEL_ID = 'biomesh-risk-v1';
const MODEL_VERSION = '1.0.0';

let _loadPromise = null;

async function ensureLoaded() {
  if (!_loadPromise) {
    _loadPromise = loader.load().catch(err => {
      console.warn('[ai.decision] model load failed, falling back to threshold:', err.message);
      return null;
    });
  }
  return _loadPromise;
}

async function evaluate(reading, history) {
  await ensureLoaded();

  if (!loader.available()) {
    return threshold.evaluate(reading, history);
  }

  const meta = loader.getMetadata();
  const features = featurePipeline.standardize(reading, meta.scaler);
  const result = await loader.run(features);

  const score = parseFloat(result.probability.toFixed(3));
  const risk = result.label;

  return {
    risk,
    score,
    reasons: [`tfjs verdict ${risk} @ ${score.toFixed(2)}`],
    model: MODEL_ID,
    version: MODEL_VERSION
  };
}

module.exports = { evaluate, MODEL_ID, MODEL_VERSION };
