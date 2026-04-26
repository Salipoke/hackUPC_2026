# BioMeshP2P - EdgeAI Implementation Guide

Full implementation plan for embedding a **pre-trained generic risk-classification model** inside every emisor (real Arduino UNO Q + PC mocks). The model receives mock sensor metrics, classifies the situation as `low` or `high` risk, appends the verdict to the JSON payload, and broadcasts to the rest of the swarm via Autobase.

This document supersedes the threshold heuristic currently in `ai/decision.js` and defines what to build.

---

## 1. Goals & Constraints

### 1.1 Functional
- **Model is generic**: identical artifact runs on UNO Q (ARM64 Linux) and on PC mocks (x86_64 Linux/macOS/Windows). One model file, one inference path.
- **Model is pre-trained**: training happens offline in Edge Impulse Studio. Emisor only loads + infers.
- **Input**: live mock metrics (`temperature`, `humidity`, `wind`, `light`, `airQuality`).
- **Output**: discrete classification `{ risk: 'low' | 'high', score: number, ... }`.
- **Side effect**: classifier output is written into the same JSON payload that the emisor appends to the Autobase ledger. Both emisores and observador receive it.

### 1.2 Non-functional
- Inference latency budget: **< 50 ms per reading** (we read every 10 s, so this is generous).
- Memory footprint on UNO Q: **< 50 MB** (we have ~4 GB on the Linux side).
- Memory footprint on STM32 (MCU): **out of scope**. Inference runs on the Qualcomm QRB2210 (Cortex-A53 quad-core), not on the Cortex-M33. The MCU is reserved for actuation only.
- Same Node.js stack as the rest of the project (no Python in the hot path).

### 1.3 Hard requirements imposed by the project doc (`FLUJO_DE_EJECUCION.md`)
- Verdict must be appended to the metric JSON before publication.
- Decision is per round (each emisor's append cycle is a round-1 emission).
- Phase 2 of the protocol (consensus + actuation) consumes the verdicts. Already stubbed in `ai/consensus.js` — out of scope here.

---

## 2. Hardware target reference (UNO Q)

| Subsystem | Component | Role for AI |
|-----------|-----------|-------------|
| MPU       | Qualcomm Dragonwing™ QRB2210 (4× Cortex-A53 @ 2 GHz, Adreno 702 GPU, Debian Linux) | **Runs the model** |
| MCU       | STM32U585 (Cortex-M33 @ 160 MHz, FPU, Zephyr OS) | Actuation only (LED matrix, RPC bridge) |
| RAM       | 2 GB or 4 GB LPDDR4 | 4 GB recommended |
| Connectivity | Wi-Fi 5 dual-band, BT 5.1 | P2P swarm |
| AI tooling | Arduino App Lab + native Edge Impulse integration | Training pipeline |

Implication: we deploy a **Linux-native model** (TFLite or ONNX), not a TinyML model. PC mocks load the same artifact through the same Node.js runtime.

---

## 3. Framework Selection

### 3.1 Options evaluated

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Edge Impulse + tflite-node (Arduino App Lab pipeline)** | Native UNO Q support; integrated with App Lab; visual training; auto-export TFLite; Node.js runtime via `@tensorflow/tfjs-node` or `tfjs-tflite-node` | Requires Edge Impulse account; binding compilation step | **Selected** |
| Manual TensorFlow + TFLite | Full control | More glue code; no UI for retraining | Backup |
| ONNX Runtime Node | Multi-vendor models | Larger binary; less aligned with Arduino tooling | Reject |
| TensorFlow.js (pure JS) | Works in Pear (no native deps) | Slower; larger model files; harder Arduino integration | Reject |
| sklearn-model export to JSON (e.g. via `sklearn-porter`) | Tiny dependency; pure JS inference | Limited model classes; no Edge Impulse path | Reject |

**Decision**: TFLite model trained in Edge Impulse, executed in Node.js via `@tensorflow/tfjs-tflite-node` on Linux x86_64 and ARM64.

### 3.2 Why TFLite for tabular data?

The metrics are 5 floats. A TFLite-quantized 3-layer MLP (e.g. `5 → 16 → 8 → 2`) weighs **<10 KB**, infers in **<1 ms** on the QRB2210, and survives quantization to int8 without measurable accuracy loss. Edge Impulse's "Classification" block produces exactly this.

---

## 4. Dataset Strategy

### 4.1 Schema

```json
{
  "temperature": 31.2,
  "humidity": 28.5,
  "wind": 35.1,
  "light": 850.4,
  "airQuality": 78.0,
  "label": "high"   // or "low"
}
```

5 numeric features + 1 categorical label. Classification, binary.

### 4.2 Sources for an "already-trained" model

We need labelled samples that represent normal vs. high-risk Barcelona environmental conditions. Options:

1. **Synthetic dataset** generated from `helper.js` distributions, programmatically labelled by domain rules (heatwave above 35 °C combined with low humidity + high air-quality index → high). Cheapest, fastest. Already partially done by the existing threshold heuristic. Use it to bootstrap a labelled CSV.
2. **Public datasets**:
   - AEMET (Agencia Estatal de Meteorología) historical Barcelona records → temperature, humidity, wind.
   - European Environment Agency (EEA) air-quality index data for Barcelona.
   - Open-Meteo API (`https://archive-api.open-meteo.com/v1/archive`) for free historical hourly data with free commercial license.
3. **Extension of `ai/data/dataset.json`** (currently 3 rows) by logging real emisor outputs over a few hours and labelling them.

Recommended for the hackathon: **option 1 + option 2 combined**. Generate ~5 000 synthetic rows + ~2 000 rows from Open-Meteo Barcelona historical for 2023–2025 heatwave periods. Total ~7 000 rows, perfectly enough for a small MLP.

### 4.3 Labels

A row is labelled `high` if any of the following hold (this rule replaces our current heuristic and is encoded *only at training time*; the model learns the function):

```text
high   if  temperature ≥ 35 °C  OR
           temperature ≤ 0 °C  OR
           wind ≥ 40 km/h       OR
           airQuality ≥ 75      OR
          (temperature ≥ 30 °C AND humidity ≤ 25 %)   ← compound risk
low    otherwise
```

The compound rule is what justifies an ML model over a pure threshold check: the AND/OR/IF tree is non-linear in feature space and the MLP captures it cleanly.

### 4.4 Train/test split

70 / 15 / 15 (train / validation / test). Stratified by label. Edge Impulse Studio handles this in the UI.

---

## 5. Training Pipeline (Edge Impulse + Arduino App Lab)

### 5.1 One-time setup

1. Create an Edge Impulse account → new project `biomesh-risk-classifier`.
2. Install Arduino App Lab on the developer's PC (not on UNO Q).
3. Sign in to Edge Impulse from App Lab (Preferences → Edge Impulse).

### 5.2 Steps

| # | Action | Where |
|---|--------|-------|
| 1 | Generate `ai/data/biomesh-train.csv` with `scripts/generate-dataset.js` (creates 7 000 labelled rows from synthetic + Open-Meteo). | Dev PC |
| 2 | Upload CSV to Edge Impulse via Studio (`Data acquisition` → `Upload data`). Format: CSV, label column = `label`. | Edge Impulse |
| 3 | In `Impulse design`: input block = "Time-series data" with 1-sample window, axes = 5 features. Processing block = "Flatten" (mean+std passthrough). Learning block = "Classification (Keras)". | Edge Impulse |
| 4 | Train: 100 epochs, batch 32, learning rate 5e-4, network `Dense(16, relu) → Dense(8, relu) → Dense(2, softmax)`. Target accuracy ≥ 95 % on test set. | Edge Impulse |
| 5 | Apply int8 quantization in `Deployment` step. | Edge Impulse |
| 6 | Export as **"TensorFlow Lite (int8 quantized)"** library. Download the `.tflite` file. | Edge Impulse |
| 7 | Save it as `ai/models/biomesh-risk-v1.tflite`. Commit to git (it is small, < 10 KB). | Repo |
| 8 | Save the metadata JSON exported alongside (label map, scaling factors) as `ai/models/biomesh-risk-v1.metadata.json`. | Repo |

### 5.3 Reproducibility

The training is deterministic given the same CSV + the same EI project ID. Document the project ID + dataset hash in `ai/models/MODEL_CARD.md` (created in step 7).

---

## 6. Repository Layout (post-implementation)

```
ai/
├── index.js                       Public API barrel, unchanged signature
├── decision.js                    Replaced: now wraps the TFLite runtime
├── consensus.js                   Unchanged (already Phase-2 stub)
├── data/
│   ├── dataset.json               Existing 3-row sample (kept for reference)
│   ├── biomesh-train.csv          Generated, large, gitignored OR LFS
│   └── README.md                  Describes how to regenerate
├── models/
│   ├── biomesh-risk-v1.tflite     The trained model (committed)
│   ├── biomesh-risk-v1.metadata.json
│   └── MODEL_CARD.md              Card with provenance, accuracy, license
└── runtime/
    ├── tflite-loader.js           Loads .tflite once at process start
    └── feature-pipeline.js        Standardizes inputs (mean/std from metadata)

scripts/
├── generate-dataset.js            Builds biomesh-train.csv
└── verify-model.js                Smoke-test inference on sample rows
```

---

## 7. Runtime Architecture

### 7.1 Module diagram

```
emisor.js
  │
  ├── helper.generateMockData()  → SensorReading
  │
  ├── ai.evaluate(reading)
  │     │
  │     ├── feature-pipeline.standardize(reading)
  │     │     uses metadata.scaler.mean / std
  │     │
  │     ├── tflite-loader.run(features)
  │     │     loaded once on require(); cached interpreter
  │     │
  │     └── decode -> Verdict { risk, score, model, version, reasons[] }
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

### 7.2 Lazy load + singleton

`ai/runtime/tflite-loader.js` loads the model once on first `evaluate()` call. Subsequent calls reuse the interpreter. No reload across the lifetime of the process.

### 7.3 Backwards compatibility

`ai/index.js` keeps the same signature `evaluate(reading, history?) -> Verdict`. Anything downstream (emisor, consensus, dashboard, observador) is untouched. Bumps `MODEL_ID = 'biomesh-risk-v1'`, `MODEL_VERSION = '1.0.0'`.

### 7.4 Fallback

If the TFLite library fails to load (e.g. PC mock without native deps installed), `decision.js` falls back to the existing threshold heuristic and emits `model: 'biomesh-threshold-v1-fallback'`. The system never crashes.

---

## 8. Step-by-step Implementation

### Phase A — Dataset (1 day)

- [ ] `scripts/generate-dataset.js`
      - Reuse `helper.randomNormal` and the threshold rules in §4.3 to label rows.
      - Add `node-fetch` call to Open-Meteo for ~2 000 historical Barcelona rows.
      - Output to `ai/data/biomesh-train.csv`.
- [ ] Add `npm run dataset` in `package.json`.
- [ ] `.gitignore`: add `ai/data/biomesh-train.csv` (large, regenerable).
- [ ] Smoke test: `npm run dataset` → CSV with ~7 000 rows, label distribution roughly 70/30 low/high.

### Phase B — Train model (Edge Impulse, 1–2 hours)

- [ ] Follow steps in §5.2.
- [ ] Save artifacts to `ai/models/`.
- [ ] Write `ai/models/MODEL_CARD.md`:
      - Project ID
      - Dataset hash (sha256 of CSV)
      - Test accuracy / F1 / confusion matrix
      - Quantization mode
      - Date trained
      - Author
      - License (MIT, internal use)

### Phase C — Runtime integration (1 day)

- [ ] Install dependency: `npm i @tensorflow/tfjs-tflite-node` (works on Linux x86_64 and ARM64; falls back to JS on macOS).
- [ ] Implement `ai/runtime/feature-pipeline.js`:
      ```js
      function standardize(reading, scaler) {
        return [
          (reading.temperature - scaler.mean[0]) / scaler.std[0],
          (reading.humidity    - scaler.mean[1]) / scaler.std[1],
          (reading.wind        - scaler.mean[2]) / scaler.std[2],
          (reading.light       - scaler.mean[3]) / scaler.std[3],
          (reading.airQuality  - scaler.mean[4]) / scaler.std[4]
        ];
      }
      ```
- [ ] Implement `ai/runtime/tflite-loader.js`:
      - Lazy load the `.tflite` and the metadata JSON on first call.
      - Expose `run(features: number[]): { probabilities: number[], labels: string[] }`.
      - Catch native-binding errors → set `available = false`.
- [ ] Rewrite `ai/decision.js`:
      ```js
      const loader  = require('./runtime/tflite-loader');
      const fp      = require('./runtime/feature-pipeline');
      const fallback = require('./decision-threshold'); // existing heuristic moved here

      function evaluate(reading, history) {
        if (!loader.available) return fallback.evaluate(reading, history);
        const features = fp.standardize(reading, loader.metadata.scaler);
        const out = loader.run(features);
        const idx = out.probabilities.indexOf(Math.max(...out.probabilities));
        const risk = out.labels[idx]; // 'low' | 'high'
        const score = out.probabilities[idx];
        return {
          risk,
          score,
          reasons: [`tflite verdict ${risk} @ ${score.toFixed(2)}`],
          model: loader.metadata.id,
          version: loader.metadata.version
        };
      }
      ```
- [ ] Move the existing threshold heuristic into `ai/decision-threshold.js` for fallback.
- [ ] Keep `ai/index.js` API stable.

### Phase D — Verification (1 hour)

- [ ] `scripts/verify-model.js`:
      - Load model.
      - Run 5 hand-crafted readings (heatwave, freeze, calm, windstorm, polluted).
      - Assert correct verdict for each.
      - Print latency per call (mean, p99).
- [ ] `npm run verify-model` in `package.json`.

### Phase E — Wire emisor.js (15 min)

`emisor.js` already calls `ai.evaluate(data, selfHistory)` and embeds the verdict in the appended JSON. **No code change needed.** Just document the new model id in the boot log:

```
peerId: emisor-arduino-2
ai.model: biomesh-risk-v1 v1.0.0
ai.runtime: tflite (loaded 8.3 KB)
```

### Phase F — Observador / Dashboard (already done)

Already broadcasts the full reading including `verdict`. Already runs `consensus.shouldTrigger` on every RX. Dashboard shows per-peer charts. **The verdict field will start carrying real ML output the moment Phase C is merged.**

Optional UI work: render a colored badge on each peer's card based on `verdict.risk`. Trivial Charts.jsx tweak. Not blocking.

### Phase G — Deploy on real Arduino UNO Q (when hardware arrives)

1. Flash Debian image on UNO Q if not already.
2. SSH into the UNO Q's Linux side: `ssh user@uno-q.local`.
3. `git clone` the repo + `npm install`.
4. `@tensorflow/tfjs-tflite-node` will compile native bindings against ARM64 → ~2 min build.
5. Run: `pear run emisor.js emisor-arduino-1`.
6. Validate with `scripts/verify-model.js` on the device itself.
7. Confirm CPU usage < 5 % at one inference per 10 s.

---

## 9. Schema Changes to JSON Payload

Before:
```json
{
  "peerId": "emisor-arduino-1",
  "timestamp": 1777142325983,
  "lat": 41.3884, "lng": 2.1568,
  "temperature": 31.2, "humidity": 28.5,
  "wind": 35.1, "light": 850.4, "airQuality": 78.0
}
```

After (the new `verdict` field is the only addition):
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
    "reasons": ["tflite verdict high @ 0.93"],
    "model": "biomesh-risk-v1",
    "version": "1.0.0"
  }
}
```

Backwards compatible: consumers that ignore `verdict` keep working.

---

## 10. Testing Matrix

| Test | Tool | Pass criterion |
|------|------|----------------|
| Unit: `feature-pipeline.standardize` | jest / tape | matches Edge Impulse Studio's normalisation for the same row |
| Unit: `tflite-loader.run` cold-start | manual | < 200 ms first call |
| Unit: `tflite-loader.run` hot path | manual | < 5 ms median |
| Unit: `decision.evaluate` accuracy | `scripts/verify-model.js` | ≥ 95 % on 1 000 held-out rows |
| Integration: emisor.js with TFLite | live run | logs `ai.model: biomesh-risk-v1` and ledger entries contain `verdict` |
| Integration: cross-peer | 3 emisores + observador | dashboard shows verdict per peer; consensus banner fires when ≥ 2 peers go `high` |
| Hardware: UNO Q | live run | inference latency < 5 ms; CPU < 5 % |
| Failure: missing TFLite native binding | env without compiler | falls back cleanly to threshold heuristic |

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `@tensorflow/tfjs-tflite-node` lacks ARM64 prebuilt | Medium | High | Pre-build wheels in CI; bundle the binary with the repo; or fall back to `@tensorflow/tfjs-node` which has wider ARM64 prebuilt support |
| Pear runtime sandbox blocks native modules | Medium | High | Emisor on PC mocks runs under plain `node` (already supported by our arg parser); only the UNO Q variant uses Pear, and Linux Pear should accept native bindings — confirm in Phase G |
| Edge Impulse account limits on free tier | Low | Low | Free tier covers small projects; switch to community plan if needed |
| Synthetic-only dataset overfits the threshold rules | Medium | Medium | Mix in Open-Meteo real samples; verify with held-out real samples |
| Model size grows beyond budget | Low | Low | We have 4 GB RAM; not a real constraint at this scale |
| Verdict inflation during clock skew across emisores | Low | Medium | Consensus already filters by `windowMs`; no change needed |
| Adversarial peer publishes fake `risk: 'high'` | Out of scope for PoC | High | Phase 5 of the AI roadmap: sign verdicts |

---

## 12. Timeline (suggested)

| Day | Deliverable |
|-----|-------------|
| Day 1 AM | Phase A — dataset generator, CSV output |
| Day 1 PM | Phase B — Edge Impulse training, model export, MODEL_CARD |
| Day 2 AM | Phase C — runtime modules + decision rewrite |
| Day 2 PM | Phase D + E + F — verification, wire-up, dashboard polish |
| Day 3 AM | Phase G — UNO Q deployment + live demo prep |
| Day 3 PM | Buffer / Phase 2 protocol consensus integration |

---

## 13. Quick Reference: Commands

```bash
# Regenerate dataset
npm run dataset

# Verify the trained model (no Edge Impulse needed at runtime)
npm run verify-model

# Run a single emisor with the AI model on
pear run emisor.js emisor-arduino-1

# Run all 3 emisores + observador + dashboard
./start.sh multi
```

---

## 14. Definition of Done

The implementation is complete when:

1. `ai/models/biomesh-risk-v1.tflite` is committed and loadable on Linux x86_64 and ARM64.
2. `npm run verify-model` passes with ≥ 95 % accuracy on the held-out test split.
3. `pear run emisor.js emisor-arduino-1` shows `ai.model: biomesh-risk-v1` and writes verdicts into the Autobase ledger.
4. Observador's RX log shows `verdict=high` or `verdict=low` for every reading.
5. Dashboard displays the verdict colour-coded per peer.
6. The full system runs cross-machine on different networks unchanged.
7. `consensus.shouldTrigger` activates when ≥ 2 of 3 peers report `high` within the 60 s window.

After that, the project is ready for Phase 2 of the protocol (consensus actuation), which is documented separately in `AI_ROADMAP.md`.
