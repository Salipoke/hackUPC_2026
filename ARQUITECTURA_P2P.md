# BioMeshP2P - Documentación de Arquitectura

## Visión General

BioMeshP2P es una red P2P descentralizada para monitorización ambiental que usa el stack de Pear (Hyperswarm, Autobase, HyperDHT).

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   EMISOR 1      │     │   EMISOR 2      │     │   EMISOR 3      │
│  (Arduino)      │     │    (PC 1)       │     │    (PC 2)       │
│   Wi-Fi         │     │   Wi-Fi         │     │   4G/Móvil      │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │    ┌──────────────────┼──────────────────────┘
         │    │                  │
         ▼    ▼                  ▼
┌─────────────────────────────────────┐
│         RED P2P (Hyperswarm)          │
│   - Descubrimiento de peers          │
│   - Conexión directa holepunching   │
└─────────────────────────────────────┘
         │
         │ (replication)
         ▼
┌─────────────────────────────────────┐
│      AUTOBASE (Ledger Compartido)    │
│   - Log inmutable multi-writer      │
│   - Consenso causal                │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│        OBSERVADOR (PC)                │
│   - Solo lectura                   │
│   - Dashboard visualización        │
└─────────────────────────────────────┘
```

---

## Componentes del Stack P2P

### 1. HyperDHT (Tabla Hash Distribuida)

**Propósito**: Descubrimiento de direcciones IP de peers.

**Cómo funciona**:
- Cada nodo tiene una **clave pública única** (como una dirección)
- Los bootstrap servers públicos ayudan a encontrar peers
- No hay servidor central: los nodos se encuentran entre sí

```
[Tu nodo] ──consulta──> [Bootstrap DHT] <──consulta── [Otro nodo]
                          │
                    "La clave X está en IP: 1.2.3.4"
```

### 2. Hyperswarm

**Propósito**: Abstrae el descubrimiento de peers y establece conexiones seguras.

**Cómo funciona**:
- Un nodo se "anuncia" en un topic (discovery key)
- Otros nodos pueden "encontrarse" automáticamente
- Maneja NAT traversal (holepunching)

```javascript
const swarm = new Hyperswarm();
swarm.join(base.discoveryKey);  // Unirse al topic del ledger
swarm.on('connection', (socket) => store.replicate(socket));
```

### 3. Autobase (Multi-writer Log)

**Propósito**: Ledger inmutable donde múltiples nodos pueden escribir.

**Cómo funciona**:
- Estructura de datos tipo DAG (Grafo Acíclico Dirigido)
- Todos los nodos tienen una copia local del log
- Replicación automática entre peers conectados
- Consenso eventual (todos convergencia al mismo estado)

```javascript
// Crear nuevo ledger (el primer nodo es writer)
const base = new Autobase(store, null, { apply });

// Otro nodo se conecta usando la misma key
const base = new Autobase(store, keyExistente, { apply });
```

---

## Flujo de Conexión

### Paso 1: Emisor inicial (Arduino/PC 1)

```
┌─────────────────────────────┐
│ 1. Crear Autobase        │
│    new Autobase(null)     │ ──> Se genera una nueva key única
│ 2. Ya es "writable"    │ ──> Puede escribir directamente
│ 3. Unirse a Hyperswarm  │ ──> Anuncia su discoveryKey
│ 4. Imprimir la KEY      │ ──> Output: "=== KEY: abc... ==="
└─────────────────────────────┘
```

### Paso 2: Otros emisores se unen

```
┌─────────────────────────────┐
│ 1. Usar la KEY del     │
│    primer emisor        │     new Autobase(store, KEY, {apply})
│ 2. Conectar via       │
│    Hyperswarm         │ ──> Se encuentra con el emisor 1
│ 3. No es writable  │ ──> Necesita ser añadido
│ 4. Request writer   │ ──> Pide permiso al emisor 1
└─────────────────────────────┘
```

### Paso 3: Observador se conecta

```
┌─────────────────────────────┐
│ 1. Usar la KEY        │
│ 2. Solo lectura     │ ──> No necesita ser writer
│ 3. Replication    │ ──> Recibe datos automáticamente
│ 4. No escribe    │ ──> Solo subscribe
└─────────────────────────────┘
```

---

## Arquitectura de 3 Emisores en Diferentes Redes

```
RED LOCAL 1              RED LOCAL 2              RED MÓVIL
(Wi-Fi casa)           (Wi-Fi oficina)        (4G/5G móvil)
   │                      │                     │
   │   ┌─────────────────┼──────────────────┘
   │   │               │         │
   ▼   ▼               ▼         ▼
┌────────────────────────────────────────┐
│      BOOTSTRAP SERVERS PÚBLICOS       │
│    (node1.hyperdht.org:49737)     │
│    (node2.hyperdht.org:49737)     │
│    (node3.hyperdht.org:49737)     │
└────────────────────────────────────────┘
         │         │         │
         └────────┼────────┘
                 ▼
    ┌─────────────────────┐
    │   HYPERSWARM        │
    │  (descubrimiento)  │
    └──────────┬──────────┘
               │
               ▼ (replication)
    ┌─────────────────────┐
    │   AUTOBASE         │
    │  (ledger shared)  │
    └──────────┬──────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌─────────┐         ┌─────────┐
│Observer │         │Dashboard│
│ (lectura│         │(visual) │
└─────────┘         └─────────┘
```

### Cómo funciona con diferentes redes:

1. **Hyperswarm + Bootstrap**: Los nodos usan los bootstrap servers
   públicos para encontrarse entre sí aunque estén en redes diferentes.

2. **NAT traversal**: Hyperswarm intenta holepunching automáticamente.

3. **Fallback**: Si no puede conectar directamente,
   puede usar los bootstrap como relay.

---

## Claves y Seeds

### Tipos de Claves

| Tipo | Uso | Ejemplo |
|------|-----|--------|
| **Autobase Key** | Identidad del ledger | `beda3817eb1f6fcb...` |
| **DHT Key** | Dirección de red | `4ebeb807b16293e...` |
| **Discovery Key** | Topic de Hyperswarm | (derivado de Autobase key) |

### Seeds (para claves deterministas)

Una **seed** es una cadena que genera una clave específica.
Si usas la misma seed, siempre-generas la misma clave.

```javascript
const SEED = 'mi-seed-única';
const keyPair = DHT.keyPair(Buffer.alloc(32).fill(SEED));
// Misma seed = misma clave siempre
```

**Usos de seeds**:
- Compartir una identidad entre dispositivos
- Mantener la misma key entre reinicios

---

## Implementación Actual

### emisor.js

```javascript
// 1. Crear ledger nuevo (null = nuevo)
const base = new Autobase(store, null, { apply });

// 2. Ya es writer automáticamente
base.writable === true

// 3. Unirse a Hyperswarm
swarm.join(base.discoveryKey);

// 4. Escribir datos
await base.append(JSON.stringify(data));
```

### observador.js

```javascript
// 1. Usar la key del emisor como argumento
const key = Pear.config.args[0];  // "pear run observador.js KEY"

// 2. Conectar al ledger existente
const base = new Autobase(store, Buffer.from(key, 'hex'), { apply });

// 3. Solo leer (no necesita ser writer)
await base.update();  // Sincronizar

// 4. Recibir en apply()
console.log(node.value.toString());
```

---

## Para 3 Emisores

### Desafíos adicionales:

1. **Multiple writers**: Todos los emisores necesitan ser writers
2. **Writer management**: Quién añade a quién como writer
3. **Consenso**: Qué pasa si escriben simultáneamente
4. **Key sharing**: Cómo compartir la key entre 3 dispositivos

### Solución propuesta:

1. **Emisor 1** (Arduino): Crea el ledger, es writer inicial
2. **Emisor 2 y 3**: Se conectan, Pedir ser añadidos como writers
3. **Apply function**: Maneja añadirs de writers automáticamente

---

## Próximos Pasos de Implementación

1. Modificar `emisor.js` para aceptar requests de otros writers
2. Permitir que múltiplesemisores escriban
3. Sincronización de clocks (timestamps)
4. Fallback a bootstrap si no hay conexión directa

---

## Referencias

- [Hyperswarm](https://github.com/holepunchto/hyperswarm)
- [Autobase](https://github.com/holepunchto/autobase)
- [HyperDHT](https://github.com/holepunchto/hyperdht)
- [Pear Runtime](https://github.com/pear/pear)