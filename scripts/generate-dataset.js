#!/usr/bin/env node
/**
 * BioMeshP2P - Dataset generator for the EdgeAI risk classifier.
 *
 * Output: ai/data/biomesh-train.csv
 * Schema: temperature,humidity,wind,light,airQuality,label
 *
 * Sources mixed (controlled by env vars):
 *   - Synthetic gaussian + extreme-event sampling (always on).
 *   - Open-Meteo historical Barcelona records (BIOMESH_FETCH_OPENMETEO=1).
 *
 * Labelling rule (encoded only at training time; the model learns f(x) -> label):
 *
 *   high if  temperature >= 35 °C
 *         OR temperature <= 0  °C
 *         OR wind        >= 40 km/h
 *         OR airQuality  >= 75
 *         OR (temperature >= 30 °C AND humidity <= 25 %)
 *   low  otherwise
 *
 * Usage:
 *   node scripts/generate-dataset.js
 *   BIOMESH_ROWS=10000 node scripts/generate-dataset.js
 *   BIOMESH_FETCH_OPENMETEO=1 node scripts/generate-dataset.js
 *
 * Notes:
 *   - airQuality is synthesised because Open-Meteo's free archive does not
 *     include AQI for arbitrary historical dates without an API key. We
 *     correlate AQI with temperature + wind, biased high during heatwaves.
 *   - Wind speed in Open-Meteo is m/s; we convert to km/h.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT_DIR  = path.join(__dirname, '..', 'ai', 'data');
const OUT_FILE = path.join(OUT_DIR, 'biomesh-train.csv');

const TOTAL_ROWS  = parseInt(process.env.BIOMESH_ROWS || '7000', 10);
const FETCH_REAL  = process.env.BIOMESH_FETCH_OPENMETEO === '1';
const SYNTH_RATIO = FETCH_REAL ? 0.7 : 1.0; // 70% synthetic, 30% real if fetching

// ---------- helpers ----------

function randomNormal(mean, stdDev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return num * stdDev + mean;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

// Seeded PRNG (Mulberry32) for reproducibility when BIOMESH_SEED is set.
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (process.env.BIOMESH_SEED) {
  const seed = parseInt(process.env.BIOMESH_SEED, 10);
  const rng = makeRng(seed);
  Math.random = rng;
  console.log(`[seed] using BIOMESH_SEED=${seed}`);
}

// ---------- labelling ----------

function labelOf(row) {
  const { temperature: t, humidity: h, wind: w, airQuality: aq } = row;
  if (t >= 35) return 'high';
  if (t <= 0)  return 'high';
  if (w >= 40) return 'high';
  if (aq >= 75) return 'high';
  if (t >= 30 && h <= 25) return 'high';
  return 'low';
}

// ---------- synthetic generator ----------

/**
 * Generate one synthetic row.
 *
 * Mode mix:
 *   - 60% normal day (gaussian around mild Barcelona conditions)
 *   - 20% summer warm day
 *   - 10% extreme heat / heatwave
 *   -  5% windstorm
 *   -  3% cold snap
 *   -  2% pollution episode
 */
function synthRow() {
  const r = Math.random();
  let temperature, humidity, wind, light, airQuality;

  if (r < 0.60) {
    // normal day
    temperature = randomNormal(20, 5);
    humidity    = randomNormal(55, 12);
    wind        = randomNormal(12, 6);
    airQuality  = randomNormal(35, 12);
  } else if (r < 0.80) {
    // summer warm day
    temperature = randomNormal(28, 3);
    humidity    = randomNormal(45, 10);
    wind        = randomNormal(14, 6);
    airQuality  = randomNormal(50, 12);
  } else if (r < 0.90) {
    // heatwave
    temperature = randomNormal(38, 3);
    humidity    = randomNormal(20, 8);
    wind        = randomNormal(10, 5);
    airQuality  = randomNormal(72, 12);
  } else if (r < 0.95) {
    // windstorm
    temperature = randomNormal(18, 5);
    humidity    = randomNormal(60, 15);
    wind        = randomNormal(55, 10);
    airQuality  = randomNormal(40, 12);
  } else if (r < 0.98) {
    // cold snap
    temperature = randomNormal(-2, 3);
    humidity    = randomNormal(70, 12);
    wind        = randomNormal(20, 8);
    airQuality  = randomNormal(45, 15);
  } else {
    // pollution episode
    temperature = randomNormal(24, 4);
    humidity    = randomNormal(50, 12);
    wind        = randomNormal(5,  3);
    airQuality  = randomNormal(85, 8);
  }

  // Light correlates with temperature (proxy for solar radiation)
  if (temperature > 25)        light = randomNormal(800, 100);
  else if (temperature > 15)   light = randomNormal(500, 120);
  else                          light = randomNormal(280, 90);

  // Clamp to physical ranges
  temperature = clamp(temperature, -15, 50);
  humidity    = clamp(humidity, 0, 100);
  wind        = clamp(wind, 0, 120);
  light       = clamp(light, 0, 1100);
  airQuality  = clamp(airQuality, 0, 100);

  return {
    temperature: round1(temperature),
    humidity:    round1(humidity),
    wind:        round1(wind),
    light:       round1(light),
    airQuality:  round1(airQuality)
  };
}

// ---------- Open-Meteo fetcher ----------

/**
 * Fetch Barcelona historical hourly records from Open-Meteo.
 * Free, no API key. License: CC BY 4.0.
 *
 * Pulls a few past summer + winter weeks to ensure variety:
 *   - 2023-07-15..2023-07-31 (summer heat)
 *   - 2024-02-01..2024-02-14 (winter)
 *   - 2024-08-01..2024-08-15 (summer)
 *   - 2025-01-10..2025-01-24 (winter)
 *
 * Returns an array of rows (no airQuality, fed by synth correlation).
 */
async function fetchOpenMeteo(targetCount) {
  const ranges = [
    ['2023-07-15', '2023-07-31'],
    ['2024-02-01', '2024-02-14'],
    ['2024-08-01', '2024-08-15'],
    ['2025-01-10', '2025-01-24']
  ];
  const lat = 41.39;
  const lon = 2.16;
  const all = [];

  for (const [start, end] of ranges) {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
                `&start_date=${start}&end_date=${end}` +
                `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation` +
                `&timezone=auto`;
    try {
      const fetchFn = (typeof fetch !== 'undefined') ? fetch : (await import('node-fetch')).default;
      const res = await fetchFn(url);
      if (!res.ok) {
        console.warn(`[open-meteo] ${start}..${end} -> HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const h = data.hourly;
      if (!h || !h.time) {
        console.warn(`[open-meteo] no hourly payload for ${start}..${end}`);
        continue;
      }
      for (let i = 0; i < h.time.length; i++) {
        const t  = h.temperature_2m[i];
        const rh = h.relative_humidity_2m[i];
        const ws = h.wind_speed_10m[i]; // km/h already in Open-Meteo default for archive endpoint
        const sw = h.shortwave_radiation[i] || 0;
        if (t == null || rh == null || ws == null) continue;
        // Approximate light (lux) from shortwave radiation (W/m^2). 1 W/m^2 ~ 120 lux for sunlight.
        const light = clamp(sw * 120, 0, 1100);
        // Synthesise airQuality biased on temperature and inverse wind.
        const aqBase = 25 + (t > 25 ? (t - 25) * 2.5 : 0) + Math.max(0, 12 - ws) * 1.5;
        const airQuality = clamp(round1(aqBase + randomNormal(0, 8)), 0, 100);
        all.push({
          temperature: round1(t),
          humidity:    round1(rh),
          wind:        round1(ws),
          light:       round1(light),
          airQuality
        });
      }
    } catch (e) {
      console.warn(`[open-meteo] fetch failed for ${start}..${end}: ${e.message}`);
    }
  }

  // Shuffle and trim to requested count
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, targetCount);
}

// ---------- main ----------

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const synthCount = Math.round(TOTAL_ROWS * SYNTH_RATIO);
  const realCount  = TOTAL_ROWS - synthCount;
  const rows = [];

  console.log(`[gen] target ${TOTAL_ROWS} rows  (synth=${synthCount}, real=${realCount})`);

  for (let i = 0; i < synthCount; i++) rows.push(synthRow());

  if (realCount > 0 && FETCH_REAL) {
    console.log('[gen] fetching Open-Meteo Barcelona records...');
    const real = await fetchOpenMeteo(realCount);
    console.log(`[gen] received ${real.length} real rows`);
    rows.push(...real);
    if (real.length < realCount) {
      const fill = realCount - real.length;
      console.log(`[gen] filling ${fill} extra synth rows`);
      for (let i = 0; i < fill; i++) rows.push(synthRow());
    }
  } else if (realCount > 0) {
    console.log('[gen] BIOMESH_FETCH_OPENMETEO not set, generating all synth.');
    for (let i = 0; i < realCount; i++) rows.push(synthRow());
  }

  // Shuffle final dataset
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  // Label + serialise
  const header = 'temperature,humidity,wind,light,airQuality,label\n';
  const out = fs.createWriteStream(OUT_FILE);
  out.write(header);

  let highCount = 0;
  for (const r of rows) {
    const label = labelOf(r);
    if (label === 'high') highCount++;
    out.write(`${r.temperature},${r.humidity},${r.wind},${r.light},${r.airQuality},${label}\n`);
  }
  out.end();

  await new Promise(resolve => out.on('finish', resolve));

  // Hash for reproducibility tracking
  const buf = fs.readFileSync(OUT_FILE);
  const hash = crypto.createHash('sha256').update(buf).digest('hex').substring(0, 16);

  const lowCount = rows.length - highCount;
  console.log('');
  console.log('=== Dataset summary ===');
  console.log(`File:           ${path.relative(process.cwd(), OUT_FILE)}`);
  console.log(`Rows:           ${rows.length}`);
  console.log(`Label low:      ${lowCount}  (${(100 * lowCount / rows.length).toFixed(1)}%)`);
  console.log(`Label high:     ${highCount}  (${(100 * highCount / rows.length).toFixed(1)}%)`);
  console.log(`Size on disk:   ${(buf.length / 1024).toFixed(1)} KB`);
  console.log(`SHA256 (16):    ${hash}`);
  console.log('');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
