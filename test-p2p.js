const DHT = require('hyperdht');
const Corestore = require('corestore');
const Autobase = require('autobase');
const Hyperswarm = require('hyperswarm');

const SEED_DHT = 'biomesh-test-seed-001';

async function test() {
  const store = new Corestore('./test-store');
  
  const base = new Autobase(store, null, {
    apply: async (nodes, view, host) => {
      for (const node of nodes) {
        console.log('RECV:', node.value.toString());
      }
    }
  });
  
  await base.ready();
  console.log('Autobase key:', base.key.toString('hex'));
  console.log('Writable:', base.writable);
  
  const swarm = new Hyperswarm();
  swarm.join(base.discoveryKey);
  
  swarm.on('connection', (socket) => {
    console.log('PEER CONNECTED!');
    store.replicate(socket);
  });
  
  if (!base.writable) {
    await new Promise(r => base.once('writable', r));
  }
  console.log('NOW WRITABLE!');
  
  // Injectar datos
  let i = 0;
  setInterval(async () => {
    i++;
    const data = JSON.stringify({ peerId: 'test-1', temp: 20 + i, time: Date.now() });
    await base.append(data);
    console.log('SENT:', data);
  }, 3000);
}

test();