# BioMeshP2P

Proyecto P2P basado en Arduino UNO Q junto con el stack de Pear para monitorizar calidad del aire, temperaturas y métricas medioambientales en Barcelona, ayudando a cuidar la biodiversidad y la salud de las personas.

## Arquitectura

- **3 emisores** (`emisor-arduino-1/2/3`) con `peerId` único, claves deterministas y replica via Hyperswarm + Autobase.
- **1 observador** que recibe los datos linealizados y los reenvía por WebSocket (`ws://localhost:8080`).
- **1 dashboard** React/Vite que consume el WebSocket y renderiza por `peerId`.

```
[Emisor 1] [Emisor 2] [Emisor 3]
        \      |      /
         Hyperswarm DHT (Autobase multi-writer)
                |
          [Observador] ── WS:8080 ──► [Dashboard:5173]
```

## Setup

```bash
npm install
cd dashboard && npm install && cd ..
```

## Quick Start

```bash
./start.sh multi
# o
npm run start:multi
```

Lanza 3 emisores + observador + dashboard. Abre **http://localhost:5173**.

## Comandos

```bash
./start.sh emisor1                # creator, primero siempre
./start.sh emisor2 [KEY]
./start.sh emisor3 [KEY]
./start.sh observador [KEY]
./start.sh dashboard
./start.sh multi                  # todo en background
./start.sh stop|status|clean|key
```

## Multi-máquina

```bash
# Máquina A
./start.sh emisor1
# Copia el KEY mostrado

# Máquina B
./start.sh emisor2 <KEY>

# Máquina C
./start.sh emisor3 <KEY>

# Máquina X (observador + dashboard)
./start.sh observador <KEY> &
./start.sh dashboard
```

## Documentación

- [`MANUAL_TESTING.md`](MANUAL_TESTING.md) — Guía completa de testing
- [`ARQUITECTURA_P2P.md`](ARQUITECTURA_P2P.md) — Arquitectura P2P
- [`FLUJO_DE_EJECUCION.md`](FLUJO_DE_EJECUCION.md) — Flujo de ejecución

## AI Risk Classifier (EdgeAI)

El sistema incluye un clasificador de riesgo entrenado con TensorFlow.js que evalúa las lecturas de sensores.

```bash
# Generar dataset (siemnpre necesario antes de entrenar)
npm run dataset:real

# Entrenar modelo
npm run train

# Verificar modelo
npm run verify-model
```

**Modelo**: MLP 5→16→8→1 (~250 parámetros, ~2.5 KB)
- Accuracy: ~98% validación
- Latencia: < 1ms hot path

### Fallback

Si el modelo tfjs no carga, usa heurística de umbrales (definido en `ai/decision-threshold.js`).

## LED Actuator

Cuando el consenso alcanza el umbral (≥2/3 emisores = HIGH), se activa el actuador:

```bash
# Test manual
node scripts/actuator-led.js on    # patrón alerta
node scripts/actuator-led.js off   # patrón seguro
node scripts/actuator-led.js flash # animación
```

**Modos**:
- **UNO Q real**: conexión serial a STM32 → matriz LED 8x13
- **PC mock**: mensaje en consola

El actuador detecta automáticamente el hardware. Si no hay `/dev/ttyACM0`, usa console alerts. Si hay hardware, envía comando RPC al STM32.

## Hardware UNO Q (futuro)

1. Conectar Arduino UNO Q por USB-C
2. Instalar `serialport`: `npm install serialport`
3. Ejecutar emisor en la placa: `pear run emisor.js emisor-arduino-1`
4. El LED se sincroniza automáticamente con el consenso
