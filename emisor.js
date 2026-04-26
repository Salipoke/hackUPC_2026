const Corestore = require('corestore');
const Autobase = require('autobase');
const Hyperswarm = require('hyperswarm');
const sodium = require('sodium-universal');
const { generateMockData } = require('./helper.js');
const ai = require('./ai');

// Args: [peerId] [baseKey?] [storeDir?]
let PEER_ID = 'emisor-arduino-1';
let BASE_KEY = null;
let STORE_DIR = null;

let argv = [];
if (typeof Pear !== 'undefined' && Pear.config.args) argv = Pear.config.args;
else if (typeof process !== 'undefined' && process.argv) argv = process.argv.slice(2);

if (argv[0]) PEER_ID = argv[0];
if (argv[1]) BASE_KEY = argv[1];
if (argv[2]) STORE_DIR = argv[2];
if (!STORE_DIR) STORE_DIR = './datos-biomesh-' + PEER_ID;

// Deterministic primaryKey from peerId → deterministic local core key
function derivePrimaryKey(peerId) {
  const out = Buffer.alloc(32);
  const input = Buffer.from('biomesh-v1:' + peerId);
  sodium.crypto_generichash(out, input);
  return out;
}

// Known peers (shared knowledge across all nodes)
const KNOWN_PEERS = ['emisor-arduino-1', 'emisor-arduino-2', 'emisor-arduino-3'];

async function iniciarNodo() {
  const primaryKey = derivePrimaryKey(PEER_ID);
  const store = new Corestore(STORE_DIR, { primaryKey, unsafe: true });

  async function apply(nodes, view, host) {
    for (const node of nodes) {
      const v = node.value;
      if (v && v.addWriter) {
        const k = Buffer.isBuffer(v.addWriter) ? v.addWriter : Buffer.from(v.addWriter, 'hex');
        console.log('apply addWriter', k.toString('hex').substring(0, 16), 'peerId:', v.peerId);
        try { await host.addWriter(k, { indexer: true }); } catch(e) { console.log('add fail:', e.message); }
      }
    }
  }

  const keyBuffer = BASE_KEY ? Buffer.from(BASE_KEY, 'hex') : null;
  const base = new Autobase(store, keyBuffer, {
    apply,
    valueEncoding: 'json',
    ackInterval: 1000
  });
  await base.ready();

  console.log('=== KEY:', base.key.toString('hex'), '===');
  console.log('peerId:', PEER_ID);
  console.log('storeDir:', STORE_DIR);
  console.log('Writable:', base.writable);
  console.log('localKey:', base.local.key.toString('hex'));

  const swarm = new Hyperswarm();
  swarm.join(base.discoveryKey);
  swarm.on('connection', (socket) => {
    console.log('peer conectado');
    store.replicate(socket);
  });

  base.on('writable', () => console.log('=== NOW WRITABLE ==='));
  base.on('unwritable', () => console.log('=== NOT WRITABLE ==='));

  // If creator (no BASE_KEY passed) → pre-add all known peers as writers
  if (!BASE_KEY && base.writable) {
    console.log('Creator: pre-adding known peers as writers');
    for (const peer of KNOWN_PEERS) {
      if (peer === PEER_ID) continue;
      const peerPrimary = derivePrimaryKey(peer);
      const tmpDir = '/tmp/biomesh-derive-' + peer + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
      const tmpStore = new Corestore(tmpDir, { primaryKey: peerPrimary, unsafe: true });
      await tmpStore.ready();
      const peerLocalKey = await Autobase.getLocalKey(tmpStore);
      await tmpStore.close();
      console.log('pre-add writer:', peer, peerLocalKey.toString('hex').substring(0, 16));
      await base.append({ addWriter: peerLocalKey.toString('hex'), peerId: peer });
    }
    await base.update();
  }

  // Local rolling history (per peer self) for AI trend analysis
  const selfHistory = [];
  const HISTORY_LIMIT = 20;

  setInterval(async () => {
    await base.update();
    if (base.writable) {
      const data = generateMockData(PEER_ID);

      // Phase 1: AI verdict on own reading
      data.verdict = ai.evaluate(data, selfHistory);

      selfHistory.push(data);
      if (selfHistory.length > HISTORY_LIMIT) selfHistory.shift();

      await base.append(data);
      const tag = data.verdict.risk === 'high' ? '!! HIGH RISK !!' : 'low';
      console.log(`>>> SENT: ${PEER_ID} ${data.temperature.toFixed(1)}°C  verdict=${tag}  score=${data.verdict.score}`);
    } else {
      console.log('not writable yet, waiting...');
    }
  }, 10000);
}

iniciarNodo().catch(e => { console.error('FATAL:', e); });
