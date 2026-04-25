const DHT = require('hyperdht');
const process = require('bare-process');
const Corestore = require('corestore');
const Autobase = require('autobase');

const publicKeyHex = '7e7a306c08e25bda7fc09d6da146597467530f6fd5e5478b461bc2f14093dda9';
const publicKey = Buffer.from(publicKeyHex, 'hex');

const autobaseKeyHex = 'e08d879715b52d76ac463a20e2356dd05f96a40567933cef201d93241be5d86a'
const autobaseKey = Buffer.from(autobaseKeyHex, 'hex');

async function conectar() {
  // 1. Directorio de almacenamiento para el ordenador
  const store = new Corestore('./datos-biomesh-observador');

  // 2. Función apply() para leer los bloques que nos llegan del Arduino 
  async function apply(nodes, view, host) {
    for (const node of nodes) {
       console.log('EVENTO RECIBIDO DE LA RED:', node.value.toString());
    }
  }

  const base = new Autobase(store, autobaseKey, { apply });
  await base.ready();

  const node = new DHT();
  const socket = node.connect(publicKey);

  socket.on('open', function () {
    console.log('Túnel perforado. Sincronizando registros inmutables...');
    // Iniciamos la sincronización de los registros 
    store.replicate(socket);

	  setInterval(async () => {
		  await base.update();
	  }, 1000);
  });

  socket.on('error', function (err) {
    console.error('Fallo en la conexión P2P:', err.code);
  });
}

conectar();
