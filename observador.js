const DHT = require('hyperdht');
const Corestore = require('corestore');
const Autobase = require('autobase');
const Hyperswarm = require('hyperswarm');

// Leer key de argumentos de Pear
let BASE_KEY = null;
if (typeof Pear !== 'undefined' && Pear.config.args && Pear.config.args.length > 0) {
  BASE_KEY = Pear.config.args[0];
}

async function conectar() {
  const store = new Corestore('./datos-biomesh-observador');

  async function apply(nodes, view, host) {
    for (const node of nodes) {
      if (node.value.addWriter) {
        console.log('OBSERVADOR: Añadiendo writer');
        await host.addWriter(node.value.addWriter, { isIndexer: true });
      } else {
        console.log('>>> RECIBIDO:', node.value.toString());
      }
    }
  }

  let base;
  if (BASE_KEY) {
    console.log('Usando key:', BASE_KEY);
    const keyBuffer = Buffer.from(BASE_KEY, 'hex');
    base = new Autobase(store, keyBuffer, { apply });
    await base.ready();
  } else {
    console.log('Creando nueva base');
    base = new Autobase(store, null, { apply });
    await base.ready();
  }

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
    console.log('length:', base.length);
  }, 3000);
}

conectar();
