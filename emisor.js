const DHT = require('hyperdht');
const Corestore = require('corestore');
const Autobase = require('autobase');
const Hyperswarm = require('hyperswarm');

function getRandomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function generateMockData() {
  const now = Date.now();
  return {
    peerId: 'emisor-arduino-1',
    timestamp: now,
    location: [41.3879, 2.1699],
    lat: 41.3879,
    lng: 2.1699,
    temperature: getRandomInRange(18, 32),
    humidity: getRandomInRange(30, 80),
    wind: getRandomInRange(0, 25),
    light: getRandomInRange(100, 1000),
    airQuality: getRandomInRange(20, 95)
  };
}

async function iniciarNodo() {
  const store = new Corestore('./datos-biomesh-emisor');

  async function apply(nodes, view, host) {
    for (const node of nodes) {
      if (node.value.addWriter) {
        console.log('EMISOR: Añadiendo writer');
        await host.addWriter(node.value.addWriter, { isIndexer: true });
      }
    }
  }

  // IMPORTANTE: null = crear NUEVA base, el emisor será el primer writer
  const base = new Autobase(store, null, { apply });
  await base.ready();
  console.log('=== KEY:', base.key.toString('hex'), '===');
  console.log('Writable:', base.writable);

  const swarm = new Hyperswarm();
  swarm.join(base.discoveryKey);
  
  swarm.on('connection', (socket) => {
    console.log('EMISOR: peer conectado');
    store.replicate(socket);
  });

  setInterval(async () => {
    if (base.writable) {
      const data = generateMockData();
      await base.append(JSON.stringify(data));
      console.log('>>> ENVIADO:', data.temperature.toFixed(1), '°C');
    }
  }, 10000);
}

iniciarNodo();
