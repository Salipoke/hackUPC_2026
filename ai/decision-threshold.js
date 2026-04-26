/**
 * Threshold-based heuristic fallback (from original ai/decision.js).
 * Used when tfjs model fails to load.
 */

const MODEL_ID = 'biomesh-threshold-v1-fallback';
const MODEL_VERSION = '0.1.0';

const THRESHOLDS = {
  temperature: { hot: 35, cold: 5, extreme_hot: 40, extreme_cold: 0 },
  humidity:    { low: 20, high: 80, extreme_low: 10, extreme_high: 95 },
  wind:        { high: 40, extreme_high: 60 },
  light:       { low: 50, extreme_high: 950 },
  airQuality:  { poor: 70, very_poor: 85 }
};

function evaluate(reading, history) {
  const reasons = [];
  let score = 0;

  if (!reading || typeof reading !== 'object') {
    return verdict('low', 0, ['empty reading'], MODEL_ID, MODEL_VERSION);
  }

  const t = reading.temperature;
  if (typeof t === 'number') {
    if (t >= THRESHOLDS.temperature.extreme_hot) {
      reasons.push(`temperature extreme hot (${t.toFixed(1)}°C)`);
      score += 0.5;
    } else if (t >= THRESHOLDS.temperature.hot) {
      reasons.push(`temperature hot (${t.toFixed(1)}°C)`);
      score += 0.25;
    } else if (t <= THRESHOLDS.temperature.extreme_cold) {
      reasons.push(`temperature extreme cold (${t.toFixed(1)}°C)`);
      score += 0.4;
    } else if (t <= THRESHOLDS.temperature.cold) {
      reasons.push(`temperature cold (${t.toFixed(1)}°C)`);
      score += 0.15;
    }
  }

  const h = reading.humidity;
  if (typeof h === 'number') {
    if (h >= THRESHOLDS.humidity.extreme_high) {
      reasons.push(`humidity extreme high (${h.toFixed(0)}%)`);
      score += 0.2;
    } else if (h >= THRESHOLDS.humidity.high) {
      reasons.push(`humidity high (${h.toFixed(0)}%)`);
      score += 0.1;
    } else if (h <= THRESHOLDS.humidity.extreme_low) {
      reasons.push(`humidity extreme low (${h.toFixed(0)}%)`);
      score += 0.2;
    }
  }

  const w = reading.wind;
  if (typeof w === 'number') {
    if (w >= THRESHOLDS.wind.extreme_high) {
      reasons.push(`wind extreme (${w.toFixed(1)} km/h)`);
      score += 0.3;
    } else if (w >= THRESHOLDS.wind.high) {
      reasons.push(`wind high (${w.toFixed(1)} km/h)`);
      score += 0.15;
    }
  }

  const aq = reading.airQuality;
  if (typeof aq === 'number') {
    if (aq >= THRESHOLDS.airQuality.very_poor) {
      reasons.push(`air quality very poor (${aq.toFixed(0)})`);
      score += 0.3;
    } else if (aq >= THRESHOLDS.airQuality.poor) {
      reasons.push(`air quality poor (${aq.toFixed(0)})`);
      score += 0.15;
    }
  }

  if (Array.isArray(history) && history.length >= 3) {
    const recent = history.slice(-3);
    const avgTemp = recent.reduce((s, r) => s + (r.temperature || 0), 0) / recent.length;
    if (typeof t === 'number' && Math.abs(t - avgTemp) > 15) {
      reasons.push(`sudden temperature spike (Δ${(t - avgTemp).toFixed(1)}°C)`);
      score += 0.2;
    }
  }

  score = Math.min(1, score);
  const risk = score >= 0.5 ? 'high' : 'low';

  if (risk === 'low' && reasons.length === 0) reasons.push('within normal envelope');

  return verdict(risk, score, reasons, MODEL_ID, MODEL_VERSION);
}

function verdict(risk, score, reasons, model, version) {
  return {
    risk,
    score: parseFloat(score.toFixed(3)),
    reasons,
    model,
    version
  };
}

module.exports = { evaluate, THRESHOLDS, MODEL_ID, MODEL_VERSION };