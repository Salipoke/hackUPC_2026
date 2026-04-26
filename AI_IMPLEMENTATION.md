# BioMeshP2P - EdgeAI Implementation Guide (V2)

Full implementation plan for embedding a **pre-trained generic risk-classification model** inside every emisor (Arduino UNO Q + PC mocks). The model receives mock sensor metrics, classifies the situation as `low` or `high` risk, appends the verdict to the JSON payload, and broadcasts to the rest of the swarm via Autobase.

> **V2 supersedes V1**. V1 (Edge Impulse + TFLite native) is deprecated. See `AI_IMPLEMENTATION_V1_DEPRECATED.md` for the historical plan and the reasons we pivoted.

---

## 0. Decisions Recorded

| ID | Question | Choice | Rationale |
|----|----------|--------|-----------|
| Q1 | Training backend | `@tensorflow/tfjs-node` (offline, dev-only) | ~10 s training vs ~3 min with pure tfjs |
| Q2 | `ai.evaluate` shape | **Async** (`await ai.evaluate(...)` in emisor.js) | Eliminates load race; trivial change |
| Q3 | Class imbalance | `classWeight` in `model.fit` | Automatic, no dataset rewrite |
| Q4 | Model artifacts | **Committed to git** (`ai/models/biomesh-risk-v1/`) | Reproducible runs without retraining; ~5 KB |
| Q5 | Fallback | Threshold heuristic kept | Robust degradation if tfjs fails to load |

---

## 1. Goals & Constraints

### 1.1 Functional
- **Generic model**: same `model.json` + weights run on UNO Q (ARM64 Linux), PC mocks (x86_64 Linux/macOS/Windows), and inside Pear runtime (Bare).
- **Pre-trained**: training is one-off via `npm run train`. Emisor only loads + infers.
- **Input**: live mock metrics (`temperature`, `humidity`, `wind`, `light`, `airQuality`).
- **Output**: discrete classification `{ risk: 'low' | 'high', score, ... }`.
- **Side effect**: classifier output written into the same JSON payload appended to the Autobase ledger. Both emisores and observador receive it.

### 1.2 Non-functional
- Inference latency: **< 5 ms hot path** (verified by spike: 0.16 ms/call plain Node, 0.26 ms/call Pear).
- Memory: **< 5 MB** (full tfjs lib ~3 MB, model + weights ~3 KB).
- Zero native compilation in runtime.
- No Pear sandbox issues (confirmed via spike).

### 1.3 Spike findings (already validated)

Validated end-to-end with a dummy 5→16→8→1 model:

| Environment | Load | Hot path inference | Notes |
|-------------|------|-------------------|-------|
| Plain Node v24, `@tensorflow/tfjs` | 15 ms | **0.16 ms/call** | Custom file IO handler |
| Pear runtime, `@tensorflow/tfjs` + Bare shim | 8 ms | **0.26 ms/call** | `globalThis.window={}; globalThis.document={}` shim, `tf.setBackend('cpu')` |

The shim is a 4-line change. Pear/Bare lacks `util.types`, so we trick tfjs into using its browser platform code path (pure JS, no `util.types` dependency).

---

## 2. Hardware target reference (UNO Q)

| Subsystem | Component | Role |
|-----------|-----------|------|
| MPU | Qualcomm Dragonwing™ QRB2210 (4× Cortex-A53 @ 2 GHz, Adreno 702 GPU, Debian Linux) | **Runs the model** |
| MCU | STM32U585 (Cortex-M33 @ 160 MHz, Zephyr) | Phase-2 actuation only |
| RAM | 2 GB or 4 GB LPDDR4 | 4 GB recommended |

We deploy a **Linux-native model** (tfjs JSON format). PC mocks run the same artifact via the same Node.js stack. ARM64 prebuilt for `tfjs-node` exists; even if it didn't, runtime uses pure `tfjs` and is arch-agnostic.

---

## 3. Framework Selection

### 3.1 Final choice: pure `@tensorflow/tfjs` (runtime) + `@tensorflow/tfjs-node` (training)

| Eje | Pure tfjs | tfjs-node | tfjs-tflite-node | Edge Impulse |
|-----|-----------|-----------|------------------|--------------|
| Native bindings | No | Yes (libtensorflow) | Yes (libtensorflow-lite) | N/A (hosted) |
| Cross-arch | Trivial | Prebuilt for major arches | ARM64 spotty | N/A |
| Pear sandbox | **OK** (verified) | Risky | Risky | N/A |
| Training speed | ~3 min | ~10 s | N/A (inference only) | UI-driven |
| Inference speed | 0.16 ms/call | < 0.05 ms/call | < 0.1 ms/call | N/A |
| Model file | `model.json` + `weights.bin` | Same | `.tflite` binary | `.tflite` binary |
| Reproducibility | `npm run train` | `npm run train` | Re-export each time | External tool |
| Hackathon-fit | High | Medium | Low | Low |

**Decision**: split.
- **Training** (offline, dev only): `@tensorflow/tfjs-node` for speed. *Caveat*: known incompat with Node 24's removal of `util.isNullOrUndefined`. If the developer is on Node ≥ 24, `train.js` should fall back to pure tfjs (3 min instead of 10 s, still tolerable). The script auto-detects.
- **Runtime** (emisor.js, including Pear): pure `@tensorflow/tfjs`. No native deps. Same `model.json` loads.

---

## 4. Dataset Strategy (unchanged from V1)

Already implemented in `scripts/generate-dataset.js`. Output: `ai/data/biomesh-train.csv`, ~7000 rows, 84.7 / 15.3 split low / high.

```bash
npm run dataset            # synthetic only
npm run dataset:real       # synthetic + Open-Meteo Barcelona records
BIOMESH_SEED=42 npm run dataset:real     # reproducible
```

Schema: `temperature,humidity,wind,light,airQuality,label`.

Labelling rule (encoded only at training time; the MLP learns it):

```text
high if  temperature >= 35 °C
      OR temperature <= 0  °C
      OR wind        >= 40 km/h
      OR airQuality  >= 75
      OR (temperature >= 30 °C AND humidity <= 25 %)
low  otherwise
```

The compound `AND` rule justifies the MLP over a pure threshold heuristic.

Class imbalance (~85 / 15) is addressed at training time via `classWeight`, not via dataset rewriting.

---

## 5. Repository Layout (post-implementation)

```
ai/
├── index.js                         Public API barrel (unchanged signature except async)
├── decision.js                      Wraps tfjs runtime + threshold fallback
├── decision-threshold.js            Existing heuristic moved here as fallback
├── consensus.js                     Unchanged (Phase-2 stub)
├── data/
│   ├── biomesh-train.csv            Generated, gitignored
│   └── README.md
├── models/
│   ├── biomesh-risk-v1/
│   │   ├── model.json               COMMITTED
│   │   └── weights.bin              COMMITTED (~3 KB)
│   ├── biomesh-risk-v1.metadata.json   COMMITTED (scaler mean/std + label map)
│   ├── MODEL_CARD.md                Provenance + accuracy + training params
│   └── dummy-spike/                 Spike artifacts (gitignored or kept for reference)
└── runtime/
    ├── train.js                     Offline training script
    ├── tfjs-loader.js               Lazy-load + inference
    └── feature-pipeline.js          Z-score normalisation
scripts/
├── generate-dataset.js              EXISTS
├── spike-create-dummy-model.js      EXISTS (validated tfjs save in pure JS)
├── spike-load-dummy-model.js        EXISTS (validated tfjs load in plain Node)
├── spike-pear-test.js               EXISTS (validated tfjs load+infer in Pear)
└── verify-model.js                  Smoke-test the trained model on hand-crafted rows
```

---

## 6. Runtime Architecture

### 6.1 Module diagram

```
emisor.js  (every 10s tick)
  │
  ├── helper.generateMockData(peerId)        → SensorReading
  │
  ├── data.verdict = await ai.evaluate(reading, selfHistory)
  │     │
  │     ├── decision.js
  │     │     ├── ensureLoaded() — lazy first-call init of tfjs-loader
  │     │     ├── if !loader.available → return decision-threshold.evaluate()
  │     │     └── else:
  │     │           ├── feature-pipeline.standardize(reading, scaler)
  │     │           ├── tfjs-loader.run(features) → probability
  │     │           └── decode → Verdict { risk, score, model, version, reasons }
  │     │
  │     └── verdict object
  │
  └── base.append({ ...reading, verdict })
                          │
                          ▼
                Autobase replication
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
        Other emisores          Observador
              │                       │
              ▼                       ▼
    consensus.shouldTrigger    broadcast → dashboard
```

### 6.2 Lazy load + singleton

`tfjs-loader.js` loads the model once on first `evaluate()`. Subsequent calls reuse the in-memory model.

### 6.3 Bare/Pear shim

`tfjs-loader.js` includes the same shim as the spike at the very top:

```js
if (typeof Bare !== 'undefined') {
  if (typeof globalThis.window === 'undefined')   globalThis.window = globalThis;
  if (typeof globalThis.document === 'undefined') globalThis.document = {};
}
const tf = require('@tensorflow/tfjs');
tf.setBackend('cpu'); // disable webgl probe (no real DOM)
```

### 6.4 Custom file IO handler

Pure tfjs ships only HTTP and `localStorage` IO handlers — no `file://`. We provide a small handler in `tfjs-loader.js` that reads `model.json` + weight shards from disk via `bare-fs` (under Pear) or Node `fs`. The handler is identical to the one in `scripts/spike-pear-test.js`. Same code path on x86 + ARM64 + Pear.

### 6.5 Backwards compatibility

`ai/index.js` keeps the same `evaluate` symbol. Only change: it is now `async`. Emisor.js needs `await`. Observador and dashboard untouched.

`MODEL_ID` becomes `'biomesh-risk-v1'`, `MODEL_VERSION` `'1.0.0'`. Fallback fires `MODEL_ID = 'biomesh-threshold-v1-fallback'`.

---

## 7. Step-by-step Implementation

### Phase A — Dataset (DONE)

`scripts/generate-dataset.js` exists. Run `npm run dataset:real` to regenerate. Class balance check is automatic (printed in summary).

### Phase B — Spike (DONE)

Three scripts validate the runtime path:

| Script | Purpose | Status |
|--------|---------|--------|
| `scripts/spike-create-dummy-model.js` | Train + save dummy 5→16→8→1 model | OK |
| `scripts/spike-load-dummy-model.js` | Load + infer in plain Node | OK (load 15 ms, hot 0.16 ms) |
| `scripts/spike-pear-test.js` | Load + infer under `pear run` | OK (load 8 ms, hot 0.26 ms) |

These scripts double as the reference implementation for the runtime modules in Phase C.

### Phase C — Runtime modules

**C.1 Move existing heuristic**
- Copy current `ai/decision.js` content into a new `ai/decision-threshold.js`. Keep its API (`evaluate(reading, history?) -> Verdict`).
- Bump its `MODEL_ID` to `'biomesh-threshold-v1-fallback'`.

**C.2 `ai/runtime/feature-pipeline.js`**
```js
'use strict';
function standardize(reading, scaler) {
  return [
    (reading.temperature - scaler.mean[0]) / scaler.std[0],
    (reading.humidity    - scaler.mean[1]) / scaler.std[1],
    (reading.wind        - scaler.mean[2]) / scaler.std[2],
    (reading.light       - scaler.mean[3]) / scaler.std[3],
    (reading.airQuality  - scaler.mean[4]) / scaler.std[4]
  ];
}
module.exports = { standardize };
```

**C.3 `ai/runtime/tfjs-loader.js`**
- Apply Bare shim if needed.
- Lazy `load()` returns a promise; safe to call repeatedly.
- `run(features) → { probability, labels }`.
- Catches any error, sets `available = false`, allows fallback.
- Custom file IO handler (copy from spike).

**C.4 `ai/runtime/train.js`**

```js
'use strict';
let tf;
let backendType = 'unknown';
try {
  tf = require('@tensorflow/tfjs-node');
  backendType = 'tfjs-node';
} catch (e) {
  console.warn('[train] tfjs-node unavailable, falling back to pure tfjs (slower):', e.message);
  tf = require('@tensorflow/tfjs');
  backendType = 'tfjs';
}

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..', '..');
const CSV_PATH   = path.join(ROOT, 'ai', 'data', 'biomesh-train.csv');
const MODEL_DIR  = path.join(ROOT, 'ai', 'models', 'biomesh-risk-v1');
const META_PATH  = path.join(ROOT, 'ai', 'models', 'biomesh-risk-v1.metadata.json');

// 1. Load CSV
const lines = fs.readFileSync(CSV_PATH, 'utf8').trim().split('\n');
lines.shift();  // header
const xs = [], ys = [];
for (const line of lines) {
  const p = line.split(',');
  if (p.length < 6) continue;
  xs.push(p.slice(0, 5).map(Number));
  ys.push(p[5].trim() === 'high' ? 1 : 0);
}

// 2. Compute scaler stats
const xsT = tf.tensor2d(xs);
const mean = xsT.mean(0);
const variance = xsT.sub(mean).square().mean(0);
const std = variance.sqrt().add(1e-8);
const meanArr = Array.from(mean.dataSync());
const stdArr  = Array.from(std.dataSync());

// 3. Normalise
const xsNorm = xsT.sub(mean).div(std);
const ysT = tf.tensor1d(ys, 'float32');

// 4. Build model
const model = tf.sequential({
  layers: [
    tf.layers.dense({ inputShape: [5], units: 16, activation: 'relu' }),
    tf.layers.dense({ units: 8,  activation: 'relu' }),
    tf.layers.dense({ units: 1,  activation: 'sigmoid' })
  ]
});
model.compile({ optimizer: tf.train.adam(5e-4), loss: 'binaryCrossentropy', metrics: ['accuracy'] });

// 5. Class weights (Q3)
const total = ys.length;
const pos   = ys.reduce((a, b) => a + b, 0);
const neg   = total - pos;
const classWeight = { 0: total / (2 * neg), 1: total / (2 * pos) };

// 6. Train
(async () => {
  await model.fit(xsNorm, ysT, {
    epochs: 80,
    batchSize: 64,
    validationSplit: 0.15,
    classWeight,
    verbose: 0,
    callbacks: {
      onEpochEnd(epoch, logs) {
        if ((epoch + 1) % 10 === 0)
          console.log(`epoch ${epoch + 1}/80  loss=${logs.loss.toFixed(4)}  val_acc=${(logs.val_acc ?? 0).toFixed(4)}`);
      }
    }
  });

  // 7. Held-out confusion matrix
  // (split logic identical to validationSplit; recompute for reporting)
  // ...

  // 8. Save model + metadata
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  await model.save(makeFileSaveHandler(MODEL_DIR));   // same pattern as spike
  fs.writeFileSync(META_PATH, JSON.stringify({
    id: 'biomesh-risk-v1',
    version: '1.0.0',
    trainedAt: new Date().toISOString(),
    backend: backendType,
    scaler: { mean: meanArr, std: stdArr },
    labels: ['low', 'high'],
    threshold: 0.5,
    classWeight
  }, null, 2));
  console.log(`saved model to ${MODEL_DIR}`);
})();
```

**C.5 `ai/decision.js`** — replace contents

```js
'use strict';
const loader   = require('./runtime/tfjs-loader');
const fp       = require('./runtime/feature-pipeline');
const fallback = require('./decision-threshold');

const MODEL_ID = 'biomesh-risk-v1';
const MODEL_VERSION = '1.0.0';

let _loadPromise = null;
function ensureLoaded() {
  if (!_loadPromise) _loadPromise = loader.load().catch(err => {
    console.warn('[ai] model load failed, falling back to threshold:', err.message);
  });
  return _loadPromise;
}

async function evaluate(reading, history) {
  await ensureLoaded();
  if (!loader.available) return fallback.evaluate(reading, history);

  const meta = loader.metadata;
  const features = fp.standardize(reading, meta.scaler);
  const { probability } = await loader.run(features);
  const score = parseFloat(probability.toFixed(3));
  const risk  = probability >= (meta.threshold ?? 0.5) ? 'high' : 'low';

  return {
    risk,
    score,
    reasons: [`tfjs verdict ${risk} @ ${score.toFixed(2)}`],
    model: MODEL_ID,
    version: MODEL_VERSION
  };
}

module.exports = { evaluate, MODEL_ID, MODEL_VERSION };
```

**C.6 `ai/index.js`** — re-export `evaluate` (same as today). Keep `consensus` exports.

### Phase D — Wire emisor.js (1 line + await)

In `emisor.js`, the setInterval already is `async`. Change:

```js
data.verdict = ai.evaluate(data, selfHistory);   // BEFORE
data.verdict = await ai.evaluate(data, selfHistory);   // AFTER
```

### Phase E — Verification

`scripts/verify-model.js`:

```js
'use strict';
const ai = require('../ai');

const cases = [
  { name: 'heatwave',   reading: { temperature: 42, humidity: 18, wind: 8,  light: 950, airQuality: 80 }, expect: 'high' },
  { name: 'freeze',     reading: { temperature: -5, humidity: 70, wind: 12, light: 200, airQuality: 30 }, expect: 'high' },
  { name: 'calm-day',   reading: { temperature: 22, humidity: 55, wind: 10, light: 600, airQuality: 35 }, expect: 'low'  },
  { name: 'windstorm',  reading: { temperature: 18, humidity: 60, wind: 65, light: 400, airQuality: 40 }, expect: 'high' },
  { name: 'pollution',  reading: { temperature: 25, humidity: 50, wind: 5,  light: 700, airQuality: 88 }, expect: 'high' }
];

(async () => {
  let pass = 0;
  for (const c of cases) {
    const t = Date.now();
    const v = await ai.evaluate(c.reading, []);
    const ok = v.risk === c.expect;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(12)} expected=${c.expect}  got=${v.risk}  score=${v.score}  model=${v.model}  ${Date.now()-t}ms`);
    if (ok) pass++;
  }
  console.log(`${pass}/${cases.length} passed`);
  process.exit(pass === cases.length ? 0 : 1);
})();
```

`package.json`:

```json
"train":         "node ai/runtime/train.js",
"verify-model":  "node scripts/verify-model.js"
```

### Phase F — Dashboard polish (optional)

Already broadcasts the full reading including `verdict`. Optional addition: colour the per-peer panel border red when `verdict.risk === 'high'`. ~10 lines in `dashboard/src/App.jsx`. Non-blocking.

### Phase G — UNO Q deployment (when hardware arrives)

1. SSH into UNO Q Linux.
2. `git clone` + `npm install` (no native compilation needed for runtime).
3. `npm run verify-model` — validates the committed model loads + classifies.
4. `pear run emisor.js emisor-arduino-1`.
5. Inference latency on Cortex-A53 expected: 0.5–1.0 ms/call (still ≪ 5 ms budget).

---

## 8. JSON Payload Schema

Same as V1. Verdict embedded:

```json
{
  "peerId": "emisor-arduino-1",
  "timestamp": 1777142325983,
  "lat": 41.3884, "lng": 2.1568,
  "temperature": 31.2, "humidity": 28.5,
  "wind": 35.1, "light": 850.4, "airQuality": 78.0,
  "verdict": {
    "risk": "high",
    "score": 0.93,
    "reasons": ["tfjs verdict high @ 0.93"],
    "model": "biomesh-risk-v1",
    "version": "1.0.0"
  }
}
```

Backwards compatible. Consumers that ignore `verdict` keep working.

---

## 9. Testing Matrix

| Test | Tool | Pass criterion |
|------|------|----------------|
| Spike: tfjs save (Node) | `node scripts/spike-create-dummy-model.js` | model.json + weights.bin written |
| Spike: tfjs load + infer (Node) | `node scripts/spike-load-dummy-model.js` | hot path < 5 ms/call |
| Spike: tfjs load + infer (Pear) | `pear run scripts/spike-pear-test.js` | hot path < 5 ms/call |
| Train: dataset → model | `npm run train` | val_acc ≥ 95 %; model artifacts committed |
| Verify: hand-crafted readings | `npm run verify-model` | 5 / 5 cases pass |
| Integration: emisor flow | `./start.sh multi` | logs `model: biomesh-risk-v1` and `verdict` in observador RX |
| Cross-peer: 3 emisores | dashboard | per-peer verdict visible; consensus banner fires when ≥ 2 high in window |
| Hardware: UNO Q | live run | inference latency < 5 ms |
| Failure: corrupt model.json | rename + run | falls back to threshold heuristic, no crash |

---

## 10. Risks & Mitigations (V2)

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `tfjs-node` Node-version incompat (Node ≥ 24 removes `util.isNullOrUndefined`) | Confirmed | Low | `train.js` falls back to pure tfjs (slower but identical output) |
| Pure tfjs CPU JS slow on UNO Q | Low | Low | 0.26 ms/call on x86 dev laptop; UNO Q ~3× slower = still well under budget |
| Pear blocks tfjs require | **Disproved** | — | Spike confirmed it works with Bare shim |
| WebGL probe fails noisily | Confirmed | Cosmetic | `tf.setBackend('cpu')` before any op silences it |
| Class imbalance hurts recall on `high` | High without mitigation | Medium | `classWeight` in `model.fit` (Q3) |
| Synthetic-only dataset overfits the labelling rule | Medium | Medium | Mix in Open-Meteo real samples (`npm run dataset:real`) |
| Native `tfjs-node` ARM64 binding missing on UNO Q | Low | Low | Training is dev-only; UNO Q only does inference (pure tfjs, no native) |
| Adversarial peer publishes fake `verdict` | Out of scope for PoC | High | Phase 5: signed verdicts |

---

## 11. Timeline

| Step | Duration | Status |
|------|----------|--------|
| Phase A — dataset generator + CSV | done | ✓ |
| Phase B — spike (Node + Pear) | done | ✓ |
| Phase C — runtime modules | 2–3 h | pending |
| Phase D — wire emisor.js (await) | 5 min | pending |
| Phase E — verify-model script | 30 min | pending |
| Phase F — dashboard polish | 30 min (optional) | pending |
| Phase G — UNO Q deploy | depends on hardware | pending |

---

## 12. Quick Reference Commands

```bash
# Dataset (already done)
npm run dataset:real

# Train
npm run train                 # → ai/models/biomesh-risk-v1/

# Verify trained model
npm run verify-model

# Spike validation (re-runnable any time)
node scripts/spike-create-dummy-model.js
node scripts/spike-load-dummy-model.js
pear run scripts/spike-pear-test.js

# Live system
./start.sh multi              # 3 emisores + obs + dashboard
```

---

## 13. Definition of Done

V2 is complete when:

1. `ai/models/biomesh-risk-v1/model.json` + `weights.bin` + metadata committed.
2. `npm run train` runs end-to-end on a dev laptop and reproduces the artifacts.
3. `npm run verify-model` returns 5/5 pass.
4. `pear run emisor.js emisor-arduino-1` boots, logs `model: biomesh-risk-v1`, and writes verdicts into the Autobase ledger.
5. Observador RX shows `verdict=high` or `verdict=low` for every reading.
6. Dashboard renders verdict per peer.
7. Cross-machine cross-network test still passes (verdict propagates).
8. `consensus.shouldTrigger` fires when ≥ 2 of 3 peers report `high` within 60 s.

After that, ready for Phase 2 of the protocol (consensus actuation) — stub already in `ai/consensus.js`, doc in `AI_ROADMAP.md`.

---

## 14. Appendix: Spike Logs (proof of viability)

```
$ node scripts/spike-create-dummy-model.js
[spike-create] using @tensorflow/tfjs (pure)
[spike-create] training 5 epochs on synthetic data...
[spike-create] saved to .../ai/models/dummy-spike
[spike-create] files:
   model.json (2005 bytes)
   weights.bin (964 bytes)
[spike-create] OK

$ node scripts/spike-load-dummy-model.js
[spike-load] loaded in 15ms
[spike-load] hot path: 1000 inferences in 159ms (0.159ms/call)
[spike-load] OK

$ pear run scripts/spike-pear-test.js
[pear-spike] tfjs required OK, version: 4.22.0
[pear-spike] loaded in 8ms
[pear-spike] hot path: 500 inferences in 130ms (0.260ms/call)
[pear-spike] OK
```
