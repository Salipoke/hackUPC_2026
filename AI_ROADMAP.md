# BioMeshP2P - AI Integration Roadmap

This document defines the path from the current threshold heuristic to a full
distributed Edge AI consensus network. Treat as authoritative for AI work.

## Goal

Each emisor independently decides if its environmental reading represents a
**high-risk situation**. Verdicts are published into the Autobase ledger. Once
a quorum of high-risk verdicts is observed, every emisor triggers a physical
mitigation event.

```
[sensor read] -> [AI decide] -> [append to Autobase + verdict]
                                    |
                            replication via Hyperswarm
                                    |
[every node sees all verdicts] -> [consensus check] -> [trigger event]
```

## Module Layout

```
ai/
├── index.js          Public API barrel
├── decision.js       evaluate(reading, history?) -> Verdict
├── consensus.js      shouldTrigger(verdicts, totalPeers?) -> { trigger, ... }
├── data/
│   └── dataset.json  Baseline samples (training / threshold tuning)
└── models/
    └── modelo_bcn.tflite   Reserved for Phase 3 binary model
```

## Schema Updates

`SensorReading` (helper.js) now contains:

```ts
interface SensorReading {
  peerId: string;
  timestamp: number;
  location: [number, number];
  lat: number; lng: number;
  temperature: number; humidity: number; wind: number;
  light: number; airQuality: number;
  verdict: Verdict | null;     // <-- new: AI verdict for this reading
}

interface Verdict {
  risk: 'low' | 'high';
  score: number;               // 0..1
  reasons: string[];           // human-readable triggers
  model: string;               // e.g. 'biomesh-threshold-v1'
  version: string;             // semver
}
```

Observador broadcasts to dashboard with extra `_consensus` snapshot:

```ts
interface BroadcastMessage extends SensorReading {
  _consensus: {
    trigger: boolean;
    highCount: number;
    totalPeers: number;
    threshold: number;        // ceil(N / 2)
    ratio: number;
  };
}
```

## Phases

### Phase 1 — Threshold heuristic (DONE skeleton)

- File: `ai/decision.js`
- Pure function on a single reading + optional history.
- Hard-coded thresholds derived from `ai/data/dataset.json` and Barcelona
  climatic norms. Tuned via inspection.
- No training step. No model file. Trivial CPU cost.
- Output: `Verdict` with `model: 'biomesh-threshold-v1'`.

**Acceptance**: emisor.js calls `ai.evaluate()` before each `base.append()`.
Verdict appears in observador RX log. Dashboard receives `verdict` field.

### Phase 2 — Statistical model

- File: `ai/decision.js` (replace heuristic body, keep API).
- Z-score against rolling per-peer history (already collected as `selfHistory`
  in emisor.js).
- Aggregate score across metrics with learned weights (offline regression on
  expanded `dataset.json`).
- Bump `MODEL_VERSION` to `0.2.0`. Keep `MODEL_ID` or rename to
  `biomesh-zscore-v1`.

**Acceptance**: Same API contract as Phase 1. Dashboard unaffected.

### Phase 3 — Distributed consensus action

- File: `ai/consensus.js` (already stub).
- Integration point: emisor.js, **not** observador.js. Each emisor:
  1. Replicates verdicts from peers via Autobase.
  2. Maintains `verdictsByPeer` map.
  3. After every own append OR every Nth Autobase update, runs
     `shouldTrigger(verdicts, KNOWN_PEERS.length)`.
  4. If `trigger === true` AND not already firing this round, calls
     `ai.triggerEvent({ peerId, decision })`.
- Quorum: `threshold = ceil(N / 2)` where N = active emisor count.
- Round semantics: define a round as a moving window of `windowMs` ms
  (default 60s in `consensus.js`). Verdicts older than window expire.
- Idempotency: track last-fired-round per peer to avoid spamming the actuator.

**Acceptance**: Two emisores publishing high-risk verdicts within the window
cause both emisores (and the third) to print/flash the trigger banner.

### Phase 4 — Real EdgeAI model on Arduino UNO Q

- File: `ai/decision.js` Phase-3 swap. Lazy-load TFLite or ONNX model from
  `ai/models/`.
- On Arduino UNO Q (Linux side): use Edge Impulse runtime via Node.js binding
  or call a sidecar Python process over IPC.
- On PC mocks: load same TFLite via `tfjs-node` or fallback to Phase 1/2.
- Feature gate by env var `BIOMESH_AI_MODEL=tflite` to choose backend.

**Acceptance**: Arduino emisor produces same `Verdict` shape from real model
inference. Mocks remain compatible.

### Phase 5 — Physical actuation (post-consensus)

- File: `ai/consensus.js::triggerEvent()`
- On Arduino UNO Q: RPC bridge to STM32, light LED matrix red pattern.
- On PC mocks: terminal banner + dashboard alert toast (already wired via
  `_consensus.trigger`).
- Optional: webhook fan-out for external systems.

## Open Design Questions

1. **Verdict in Autobase as separate event vs embedded in reading?**
   Currently embedded. Pro: atomic with reading. Con: cant publish a verdict
   without resending metrics. For Phase 3, may split into a separate
   `{ type: 'verdict', peerId, ts, verdict }` block.

2. **Round synchronization across emisores.**
   Currently time-window based. Alternative: explicit round counter in
   ledger. Time-window is simpler and matches eventual-consistency model.

3. **Trust model for verdicts.**
   Any writer can lie. For PoC, we trust pre-known peers. For production,
   verdicts should be signed by a dedicated keypair per emisor and verified
   in `apply()`.

4. **Dataset growth.**
   `ai/data/dataset.json` only has 3 samples. Need to log real readings
   (anonymized) into a Phase-2 training set.

## Testing

Unit-test `ai/decision.js` and `ai/consensus.js` in isolation:

```bash
node -e "const ai = require('./ai'); console.log(ai.evaluate({temperature: 42, humidity: 90, wind: 65, airQuality: 90}))"
node -e "const ai = require('./ai'); console.log(ai.shouldTrigger([
  {peerId:'a', verdict:{risk:'high',score:0.9}, timestamp: Date.now()},
  {peerId:'b', verdict:{risk:'high',score:0.7}, timestamp: Date.now()},
  {peerId:'c', verdict:{risk:'low', score:0.1}, timestamp: Date.now()}
]))"
```

Expected: first prints `risk: 'high'`. Second prints `trigger: true, highCount: 2, threshold: 2`.

## Deferred / Out of Scope

- Federated learning between emisores.
- On-the-fly model weight sync via Autobase.
- Anomaly explanations beyond `reasons[]`.
- Multi-class risk (only `low`/`high` for now).
