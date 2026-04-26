/**
 * BioMeshP2P sensor data generator (mock).
 *
 * Produces a SensorReading with the schema consumed by ai/decision.js,
 * observador.js, and the dashboard.
 *
 * Schema:
 *   {
 *     peerId:      string,
 *     timestamp:   number (ms epoch),
 *     location:    [lat, lng],
 *     lat:         number,
 *     lng:         number,
 *     temperature: number (°C),
 *     humidity:    number (%),
 *     wind:        number (km/h),
 *     light:       number (lux),
 *     airQuality:  number (0..100, higher = worse),
 *     verdict:     null | { risk, score, reasons, model, version }   // populated by emisor.js
 *   }
 *
 * Note: 'verdict' is intentionally left null here. emisor.js fills it after
 * calling ai.evaluate(reading). This keeps generation pure and lets us swap
 * the AI module without touching the data generator.
 */

function randomNormal(mean, stdDev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return num * stdDev + mean;
}

function generateMockData(peerId) {
  const id = peerId || 'emisor-arduino-1';

  const range = (min, max, decimals = 1) =>
    parseFloat((Math.random() * (max - min) + min).toFixed(decimals));

  // Temperature: gaussian around 25°C, occasional extreme spike for AI testing
  let temperature = randomNormal(25, 5);
  const isSpike = Math.random() < 0.10;
  if (isSpike) {
    temperature = Math.random() > 0.5 ? range(80, 100) : range(-30, -10);
  }

  // Humidity: inverse-ish to temperature
  let humidity;
  if (temperature >= 35) {
    humidity = range(80, 100);
  } else {
    humidity = Math.max(0, Math.min(100, randomNormal(50, 15)));
  }

  // Light: higher when warmer
  let light = (temperature > 25) ? randomNormal(800, 100) : randomNormal(300, 50);
  light = Math.max(0, Math.min(1000, light));

  const lat = range(41.3800, 41.4000, 4);
  const lng = range(2.1500, 2.1700, 4);

  return {
    peerId: id,
    timestamp: Date.now(),
    location: [lat, lng],
    lat,
    lng,
    temperature: parseFloat(temperature.toFixed(1)),
    humidity: parseFloat(humidity.toFixed(1)),
    wind: parseFloat(Math.max(0, randomNormal(15, 10)).toFixed(1)),
    light: parseFloat(light.toFixed(1)),
    airQuality: range(0, 100),
    verdict: null
  };
}

module.exports = { generateMockData };
