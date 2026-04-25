import L from 'leaflet'
import { base } from './db.js' // On tinguis la teva config d'Autobase

// 1. Inicialitzar el mapa centrat a Barcelona
const map = L.map('map').setView([41.3851, 2.1734], 13)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map)

const markers = {}

// 2. Funció per actualitzar la interfície
async function updateUI() {
  await base.view.update() // Sincronitzem dades P2P
  
  for (const node of base.view) {
    const data = JSON.parse(node.value)
    
    // Si el pin no existeix, el creem
    if (!markers[data.id]) {
      const marker = L.marker([data.lat, data.lon]).addTo(map)
      
      // Quan cliquem al pin, omplim el panell de detalls
      marker.on('click', () => {
        document.getElementById('data-content').style.display = 'block'
        document.getElementById('node-name').innerText = `Node: ${data.id}`
        document.getElementById('val-temp').innerText = (data.temp - 273.15).toFixed(1)
        document.getElementById('val-hum').innerText = data.hum
        document.getElementById('val-wind').innerText = data.wind
        document.getElementById('val-air').innerText = data.air
        document.getElementById('val-time').innerText = new Date(data.timestamp).toLocaleTimeString()
      })
      
      markers[data.id] = marker
    } else {
      // Si ja existeix, només actualitzem la posició
      markers[data.id].setLatLng([data.lat, data.lon])
    }
  }
}

// 3. Escoltant canvis a la xarxa
base.on('append', updateUI)
updateUI()