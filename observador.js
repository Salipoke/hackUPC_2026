// Intentar usar ws de Node.js, fallback a bare-ws
let WebSocket, wssFunction;
let isNodeWs = false;

try {
  WebSocket = require('ws');
  wssFunction = WebSocket.Server;
  isNodeWs = true;
  console.log('Usando ws (Node.js)');
} catch(e) {
  WebSocket = require('bare-ws');
  wssFunction = WebSocket.Server;
  isNodeWs = false;
  console.log('Usando bare-ws (Pear)');
}

const DHT = require('hyperdht');
const Corestore = require('corestore');
const Autobase = require('autobase');
const Hyperswarm = require('hyperswarm');
const ai = require('./ai');

// WebSocket server para el dashboard
const wss = new wssFunction({ port: 8080 });
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('Dashboard Web conectado');
  clients.add(ws);
  ws.on('close', () => {
    console.log('Dashboard Web desconectado');
    clients.delete(ws);
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (isNodeWs) {
      // ws (Node.js): use send()
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    } else {
      // bare-ws (Pear): use write()
      if (client.ready) {
        client.write(msg);
      }
    }
  }
}

// Leer key - soporte tanto para Pear como Node.js
let BASE_KEY = null;

// Desde Pear config
if (typeof Pear !== 'undefined' && Pear.config.args && Pear.config.args.length > 0) {
  BASE_KEY = Pear.config.args[0];
} 
// Desde argumentos de línea de comandos (process.argv)
else if (typeof process !== 'undefined' && process.argv && process.argv.length > 2) {
  BASE_KEY = process.argv[2];
}
// Desde archivo generado por emisor
else {
  try {
    const fs = require('fs');
    if (fs.existsSync('./emisor-key.txt')) {
      BASE_KEY = fs.readFileSync('./emisor-key.txt', 'utf8').trim();
      console.log('Key leída de emisor-key.txt:', BASE_KEY);
    }
  } catch(e) {}
}

async function conectar() {
  const store = new Corestore('./datos-biomesh-observador');

  // Latest verdict per peer (used for consensus monitoring)
  const verdictsByPeer = new Map();

  function evaluateConsensus() {
    const entries = [];
    for (const [peerId, e] of verdictsByPeer) entries.push(e);
    const decision = ai.shouldTrigger(entries);
    return decision;
  }

  async function apply(nodes, view, host) {
    for (const node of nodes) {
      const v = node.value;
      if (v && v.addWriter) {
        const k = Buffer.isBuffer(v.addWriter) ? v.addWriter : Buffer.from(v.addWriter, 'hex');
        console.log('OBSERVADOR apply: addWriter', k.toString('hex').substring(0, 16), 'peerId:', v.peerId);
        try { await host.addWriter(k, { indexer: true }); } catch(e) { console.log('add fail:', e.message); }
      } else if (v) {
        const verdictTag = v.verdict ? `verdict=${v.verdict.risk}` : 'no-verdict';
        console.log('>>> RX:', v.peerId, v.temperature?.toFixed?.(1), verdictTag);

        if (v.verdict && v.peerId) {
          verdictsByPeer.set(v.peerId, {
            peerId: v.peerId,
            verdict: v.verdict,
            timestamp: v.timestamp || Date.now()
          });
        }

        // Broadcast reading + current consensus snapshot for dashboard
        const decision = evaluateConsensus();
        broadcast({ ...v, _consensus: decision });

        if (decision.trigger) {
          // Phase 2: observador prints alert. In production this would just be UI.
          console.log(`[CONSENSUS] HIGH RISK consensus: ${decision.highCount}/${decision.totalPeers} (threshold ${decision.threshold})`);
        }
      }
    }
  }

  const keyBuffer = BASE_KEY ? Buffer.from(BASE_KEY, 'hex') : null;
  console.log(BASE_KEY ? 'Joining base: ' + BASE_KEY : 'Creating new base');
  const base = new Autobase(store, keyBuffer, {
    apply,
    valueEncoding: 'json',
    ackInterval: 1000
  });
  await base.ready();

  console.log('=== KEY:', base.key.toString('hex'), '===');
  console.log('Writable:', base.writable);

  const swarm = new Hyperswarm();
  swarm.join(base.discoveryKey);

  swarm.on('connection', (socket) => {
    console.log('OBSERVADOR: peer conectado');
    store.replicate(socket);
  });

  setInterval(async () => {
    await base.update();
    let aw = 0;
    const ws = [];
    if (base.activeWriters) {
      for (const w of base.activeWriters) {
        aw++;
        ws.push(w.core.key.toString('hex').substring(0,16));
      }
    }
    console.log('[STATE] activeWriters:', aw, ws.join(','), 'writable:', base.writable);
  }, 5000);
}

conectar();
