# Manual de Testing - BioMeshP2P (Multi-Emisor)

Sistema P2P con **3 emisores** (`emisor-arduino-1/2/3`), 1 observador y 1 dashboard.
Usa Autobase con writers pre-añadidos por clave determinista derivada del `peerId`.

---

## Requisitos

- Node.js 18+
- Pear runtime (`npm i -g pear`)
- `npm install` en raíz y en `dashboard/`

```bash
cd hackUPC_2026
npm install
cd dashboard && npm install && cd ..
```

---

## Quick Start (1 comando, todo local)

```bash
./start.sh multi
# o equivalente:
npm run start:multi
```

Lanza en orden:
1. Emisor 1 (creator) → imprime `=== KEY: <hex> ===`
2. Observador (port 8080)
3. Emisor 2
4. Emisor 3
5. Dashboard (port 5173)

Dashboard: **http://localhost:5173**

---

## Arquitectura Multi-Emisor

```
Emisor 1 (creator)        Emisor 2              Emisor 3
   |                        |                       |
   | Autobase.append()      | Autobase.append()     | Autobase.append()
   |                        |                       |
   +------+-----------------+-----------------------+
          |
          | Hyperswarm DHT (discoveryKey = base.discoveryKey)
          |
          v
       Observador
          |
          | apply(nodes) → broadcast(JSON)
          |
          v
   WebSocket :8080
          |
          v
      Dashboard (port 5173)
```

Cada `peerId` deriva determinísticamente su `primaryKey` via SHA-256 → cada nodo conoce las writer keys de los otros sin coordinación. Emisor 1 (creator) ejecuta `base.append({addWriter: <key>})` para `emisor-arduino-2` y `emisor-arduino-3` al arrancar.

---

## Modo Manual (terminales separadas)

### Terminal 1 - Emisor 1 (creator, primero siempre)

```bash
./start.sh emisor1
# o:
npm run emisor1
```

Output:
```
=== KEY: 75e5dadf26d7a4b074a0b7efc03b5334553fa5b0d16da67b220de4b7ba9cc1bb ===
peerId: emisor-arduino-1
Writable: true
Creator: pre-adding known peers as writers
pre-add writer: emisor-arduino-2 f1e98b2c0872325d
pre-add writer: emisor-arduino-3 eac47d8eb5844fcd
>>> SENT: emisor-arduino-1 26.3 °C
```

Copia la `KEY` (64 hex). Es **determinista** — siempre la misma para `emisor-arduino-1`.

### Terminal 2 - Observador

```bash
./start.sh observador <KEY>
# o auto-leer key del log:
./start.sh observador
```

Output esperado tras unos segundos:
```
OBSERVADOR apply: addWriter f1e98b2c0872325d peerId: emisor-arduino-2
OBSERVADOR apply: addWriter eac47d8eb5844fcd peerId: emisor-arduino-3
>>> RX: emisor-arduino-1 26.3
[STATE] activeWriters: 4 ...
```

### Terminal 3 - Emisor 2

```bash
./start.sh emisor2 <KEY>
# o auto-key:
./start.sh emisor2
```

### Terminal 4 - Emisor 3

```bash
./start.sh emisor3 <KEY>
```

### Terminal 5 - Dashboard

```bash
./start.sh dashboard
# o:
npm run dashboard
```

Abre **http://localhost:5173**.

---

## Verificar Multi-Emisor

### 1. Observador debe ver los 3 peers

```bash
tail -f /tmp/biomesh-observador.log | grep ">>> RX:"
```

Esperar:
```
>>> RX: emisor-arduino-1 27.2
>>> RX: emisor-arduino-2 24.1
>>> RX: emisor-arduino-3 28.7
```

### 2. activeWriters = 4

```bash
grep "STATE" /tmp/biomesh-observador.log | tail -3
```

Esperar `activeWriters: 4` (observador + 3 emisores).

### 3. WebSocket muestra 3 peers distintos

```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8080');
const peers = new Map();
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.peerId) peers.set(m.peerId, (peers.get(m.peerId)||0)+1);
});
setTimeout(() => {
  console.log('Peers seen:');
  for (const [k,v] of peers) console.log(' ', k, ':', v);
  process.exit(0);
}, 30000);
"
```

Tras 30s debe imprimir 3 peerIds distintos.

---

## Multi-Máquina (red real)

Mismo código en cada máquina. Coordinación solo via base KEY.

**Máquina A** (creator):
```bash
./start.sh emisor1
# anota la KEY
```

**Máquina B**:
```bash
./start.sh emisor2 <KEY-de-A>
```

**Máquina C**:
```bash
./start.sh emisor3 <KEY-de-A>
```

**Máquina X** (observador + dashboard):
```bash
./start.sh observador <KEY-de-A> &
./start.sh dashboard
```

Hyperswarm DHT atraviesa NAT automáticamente. Si falla → revisar firewall puerto UDP saliente.

---

## NPM Scripts

```bash
npm run emisor1           # pear run emisor.js emisor-arduino-1
npm run emisor2           # pear run emisor.js emisor-arduino-2
npm run emisor3           # pear run emisor.js emisor-arduino-3
npm run observador        # node observador.js (key como arg)
npm run dashboard         # cd dashboard && vite
npm run start:multi       # ./start.sh multi (todo local)
npm run stop              # ./start.sh stop
npm run status            # ./start.sh status
npm run clean             # rm -rf datos + logs
```

---

## Comandos `start.sh`

```
./start.sh emisor1         Emisor 1 (creator). Lanzar primero.
./start.sh emisor2 [KEY]   Emisor 2. Sin KEY lee log de emisor1.
./start.sh emisor3 [KEY]   Emisor 3.
./start.sh observador [KEY]
./start.sh dashboard
./start.sh multi           Todo local en background. Default.
./start.sh stop            Mata todos los procesos biomesh.
./start.sh status          Procesos activos + última KEY.
./start.sh clean           Borra datos-biomesh-* y logs.
./start.sh key             Imprime última KEY.
```

---

## Estructura de Datos

```json
{
  "peerId": "emisor-arduino-2",
  "timestamp": 1777154211340,
  "location": [41.3878, 2.1596],
  "lat": 41.3878,
  "lng": 2.1596,
  "temperature": 29.4,
  "humidity": 35,
  "wind": 18,
  "light": 788.6,
  "airQuality": 8.6
}
```

`peerId` ahora es discriminador real → dashboard distingue datos por emisor.

---

## Troubleshooting

### Puerto 8080 ocupado

```bash
lsof -ti:8080 | xargs -r kill -9
```

### Observador solo ve emisor 1

- Verifica los 3 emisores corren: `./start.sh status`
- Espera 30-60s. Sincronización de writers requiere unos ciclos.
- Confirma misma KEY en todos.

### Emisor 2/3 no llega a `Writable: true`

- Asegúrate de que emisor 1 arrancó **primero** y completó `Creator: pre-adding known peers`.
- Si falla, `./start.sh clean` y reinicia.

### Logs

```
/tmp/biomesh-emisor1.log
/tmp/biomesh-emisor2.log
/tmp/biomesh-emisor3.log
/tmp/biomesh-observador.log
/tmp/biomesh-dashboard.log
```

### Reset total

```bash
./start.sh stop
./start.sh clean
./start.sh multi
```

---

## Flujo de Datos Detallado

```
emisor.js (peerId=emisor-arduino-N)
    │
    ├─ derivePrimaryKey(peerId) → primaryKey determinista
    ├─ Corestore({primaryKey, unsafe:true})
    ├─ Autobase(store, BASE_KEY?, {apply, valueEncoding:'json'})
    │
    │  Si creator (sin BASE_KEY):
    │    └─ pre-add writers de emisor-arduino-2 y emisor-arduino-3
    │
    ├─ generateMockData(peerId) → JSON
    ├─ ai.evaluate(data, history) → verdict (async, tfjs or fallback)
    └─ base.append({...data, verdict})
              │
              │ Hyperswarm replication (discoveryKey = base.discoveryKey)
              ▼
observador.js
    │
    ├─ Autobase con misma KEY
    ├─ apply(nodes) recorre cada node
    │    ├─ value.addWriter → host.addWriter()
    │    └─ value tipo data → broadcast(value) + consensus.check()
    └─ consensus.shouldTrigger()
         └─ Si ≥2/3 peers HIGH → triggerEvent() → LED alert
    │
    └─ WebSocket :8080
              │
              ▼
dashboard/App.jsx
    │
    ├─ ws.onmessage(data)
    └─ setState por peerId → Charts/Map renderizan
```

---

## AI Model Testing

### Verify Model Loads

```bash
node -e "
const ai = require('./ai');
(async () => {
  const v = await ai.evaluate({temperature:42, humidity:15, wind:10, light:900, airQuality:80}, []);
  console.log('verdict:', v);
})();
"
```

Expected: `risk: 'high'`, `model: 'biomesh-risk-v1'`

### Verify Model Accuracy

```bash
npm run verify-model
```

Expected: 5/5 test cases pass.

### Manual Test Cases

| Name | Input | Expected |
|------|-------|----------|
| heatwave | temp=42, hum=18, wind=8, light=950, aq=80 | high |
| freeze | temp=-5, hum=70, wind=12, light=200, aq=30 | high |
| calm-day | temp=22, hum=55, wind=10, light=600, aq=35 | low |
| windstorm | temp=18, hum=60, wind=65, light=400, aq=40 | high |
| pollution | temp=25, hum=50, wind=5, light=700, aq=88 | high |

---

## LED Actuator Testing

### Manual LED Test

```bash
npm run led:on      # Alert pattern (RED)
npm run led:off     # Safe pattern (GREEN)
npm run led:flash   # Pulse animation
```

### Expected Output (PC mock mode)

```
[led] PC mock mode - using console alerts
[led] ON (RED - HIGH RISK)
[led] display: alert
[led] *************
[led] *         *
[led] *  alert  *
[led] *  !!    *
[led] ...
```

### Consensus → LED Trigger

When 2/3 peers report `HIGH` risk:

```bash
tail -f /tmp/biomesh-observador.log | grep -E "CONSENSUS|led"
```

Expected:
```
[CONSENSUS] HIGH RISK consensus: 2/3 (threshold 2)
============================================================
!!! BIOMESH ALERT !!!
Peer:        observador
High count:  2 / 3
============================================================
[led] ON (RED - HIGH RISK)
```

---

## Training (Optional)

If modifying the model:

```bash
# Clean old model
rm -rf ai/models/biomesh-risk-v1

# Generate dataset
npm run dataset:real

# Train
npm run train

# Verify
npm run verify-model
```

Model artifacts: `ai/models/biomesh-risk-v1/{model.json,weights.bin,metadata.json}`
