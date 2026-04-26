# BioMeshP2P

A decentralized P2P environmental monitoring network for Barcelona that uses Arduino UNO Q nodes with local TensorFlow.js EdgeAI to detect high-risk environmental conditions and trigger collective alerts.

---

## Overview

BioMeshP2P is a peer-to-peer system where 3 emisor nodes monitor environmental metrics (temperature, humidity, wind, light, air quality), classify risk locally using a TensorFlow.js model, and reach consensus to trigger alerts. Built on the [Pear stack](https://github.com/pear/pear) (Hyperswarm, Autobase, HyperDHT).

```
[Emisor 1] [Emisor 2] [Emisor 3]     ← Pear runtime (UNO Q or PC mocks)
         \       |       /
          HyperDHT + Hyperswarm       ← P2P discovery + replication
                  |
              Autobase              ← Multi-writer immutable log
                  |
            [Observador] ── WS:8080 ──► [Dashboard:5173]
```

---

## Quick Start

```bash
# Install dependencies
npm install
cd dashboard && npm install && cd ..

# Launch full system (3 emisores + observador + dashboard)
./start.sh multi

# Or via npm
npm run start:multi
```

Open **http://localhost:5173** to view the dashboard.

---

## Architecture

### Nodes

| Node | Runtime | Role |
|------|---------|------|
| `emisor-arduino-1` | Pear | Writer, generates sensor data + AI verdict |
| `emisor-arduino-2` | Pear | Writer, generates sensor data + AI verdict |
| `emisor-arduino-3` | Pear | Writer, generates sensor data + AI verdict |
| `observador` | Node.js | Read-only, broadcasts to WebSocket |
| `dashboard` | React/Vite | Visualizes readings per peer |

### Protocol

1. Each emisor generates mock sensor readings every 10 seconds
2. Local TensorFlow.js model classifies risk (`low` or `high`)
3. Reading + verdict appended to shared Autobase log
4. Observador receives all readings, checks consensus
5. If ≥2/3 peers report `HIGH`, trigger LED alert

---

## Commands

```bash
# Individual nodes
./start.sh emisor1                # Creator (must run first)
./start.sh emisor2 <KEY>          # Join using KEY from emisor1
./start.sh emisor3 <KEY>          # Join using KEY from emisor1
./start.sh observador <KEY>         # Observer joins ledger
./start.sh dashboard              # React dev server

# Full system
./start.sh multi                 # 3 emisores + observador + dashboard (background)
./start.sh local                 # Local single-machine mode

# Utility
./start.sh stop                  # Stop all processes
./start.sh status               # Show running nodes
./start.sh clean                # Clear data directories

# Or use npm scripts
npm run emisor1                  # pear run emisor.js emisor-arduino-1
npm run emisor2                  # pear run emisor.js emisor-arduino-2
npm run emisor3                  # pear run emisor.js emisor-arduino-3
npm run observador               # node observador.js
npm run dashboard               # cd dashboard && npm run dev
```

---

## Cross-Machine / Cross-Network

```bash
# Machine A
./start.sh emisor1
# Copy the KEY printed (e.g., 75e5dadf...)

# Machine B
./start.sh emisor2 <KEY>

# Machine C
./start.sh emisor3 <KEY>

# Machine X (observer + dashboard)
./start.sh observador <KEY> &
./start.sh dashboard
```

---

## AI Model (EdgeAI)

Trained TensorFlow.js MLP classifier for environmental risk detection.

### Training & Verification

```bash
# Generate dataset (synthetic + Open-Meteo Barcelona)
npm run dataset:real

# Train model
npm run train

# Verify model
npm run verify-model
```

### Model Details

| Metric | Value |
|--------|-------|
| Architecture | MLP: 5 → 16 → 8 → 1 |
| Parameters | ~250 |
| File size | ~2.5 KB |
| Validation accuracy | ~98% |
| Inference latency | < 1ms (hot path) |
| Fallback | Threshold heuristic (`ai/decision-threshold.js`) |

### Input Features

- `temperature` (°C)
- `humidity` (%)
- `wind` (km/h)
- `light` (lux)
- `airQuality` (0–100)

### Output

- `risk`: `'low'` | `'high'`
- `score`: 0–1 confidence
- `model`: `'biomesh-risk-v1'`

---

## LED Actuator

When consensus threshold is met (≥2/3 peers = `HIGH`), triggers alert.

### Manual Test

```bash
npm run led:on      # Alert pattern (RED)
npm run led:off     # Safe pattern (GREEN)
npm run led:flash   # Attention pulse
```

### Modes

| Mode | Behavior |
|------|--------|
| UNO Q real | Serial RPC to STM32 → 8×13 LED matrix |
| PC mock | Console ASCII art pattern |

Auto-detected: if `/dev/ttyACM0` unavailable, uses console output.

---

## Project Structure

```
├── emisor.js                 # Emisor node (Pear runtime)
├── observador.js              # Observer node (Node.js)
├── start.sh                 # Process launcher
├── ai/
│   ├── index.js             # Public AI API
│   ├── decision.js          # TFjs classifier + fallback
│   ├── decision-threshold.js  # Threshold fallback
│   ├── consensus.js        # Consensus logic + LED trigger
│   ├── runtime/
│   │   ├── train.js       # Training script
│   │   ├── tfjs-loader.js # Model loader
│   │   └── feature-pipeline.js # Z-score normalization
│   └── models/
│       └── biomesh-risk-v1/  # Trained model artifacts
├── scripts/
│   ├── actuator-led.js     # LED controller
│   ├── generate-dataset.js  # Dataset generator
│   └── ...
└── dashboard/            # React frontend
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [`Documentation/ARQUITECTURA_P2P.md`](Documentation/ARQUITECTURA_P2P.md) | P2P stack architecture |
| [`Documentation/FLUJO_DE_EJECUCION.md`](Documentation/FLUJO_DE_EJECUCION.md) | Execution flow protocol |
| [`Documentation/AI_IMPLEMENTATION.md`](Documentation/AI_IMPLEMENTATION.md) | AI model implementation (V2) |
| [`Documentation/AI_ROADMAP.md`](Documentation/AI_ROADMAP.md) | Feature roadmap |
| [`Documentation/MANUAL_TESTING.md`](Documentation/MANUAL_TESTING.md) | Testing guide |

---

## Dependencies

- **Runtime**: [Pear](https://github.com/pear/pear) (for emitters)
- **P2P Stack**: `hyperswarm`, `hyperdht`, `autobase`, `corestore`
- **AI**: `@tensorflow/tfjs` (pure JS, no native bindings)
- **Dashboard**: React + Vite + WebSocket

---

## License

ISC