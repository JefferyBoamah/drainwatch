'use strict';

const WEIGHTS = { blockage: 0.35, rain: 0.25, floodRisk: 0.25, exposure: 0.15 };
const CONDITION_VALUE = { clear: 0, partial: 0.5, full: 1 };
const CONDITION_WORDS = { clear: 'Clear', partial: 'Partly blocked', full: 'Fully blocked' };
const CORROBORATION_BONUS = 0.1;
const RAIN_FULL_MM = 50;
const HOUR_MS = 3600 * 1000;

function clamp01(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function blockage(condition, ageDays, distinctReporters) {
  if (!Object.prototype.hasOwnProperty.call(CONDITION_VALUE, condition)) return 0;
  const freshness = Math.max(0.5, 1 - Math.max(0, ageDays) / 28);
  // The bonus backs up a blockage claim, so it never lifts a drain reported as clear.
  const bonus = condition !== 'clear' && distinctReporters >= 2 ? CORROBORATION_BONUS : 0;
  return clamp01(CONDITION_VALUE[condition] * freshness + bonus);
}

function rainScore(sumMm) {
  return clamp01(sumMm / RAIN_FULL_MM);
}

function band(score) {
  if (score > 0.66) return 'high';
  if (score > 0.4) return 'medium';
  return 'low';
}

function level(v) {
  if (v >= 0.6) return 'high';
  if (v >= 0.4) return 'medium';
  return 'low';
}

function explain(input, components) {
  const parts = [];
  if (!input.condition) {
    parts.push('No report yet.');
  } else {
    const days = Math.floor(Math.max(0, input.ageDays));
    const when = days < 1 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago';
    parts.push(CONDITION_WORDS[input.condition] + ', last checked ' + when + '.');
  }
  if (input.condition && input.condition !== 'clear' && input.distinctReporters >= 2) {
    parts.push(input.distinctReporters + ' people reported this in the last 48 hours.');
  }
  if (input.rainMm == null) {
    parts.push('The rain forecast is not available, so rain is counted as zero.');
  } else if (components.rain >= 0.5) {
    parts.push('Heavy rain is expected (' + Math.round(input.rainMm) + ' mm in 72 hours).');
  } else if (components.rain > 0) {
    parts.push('Some rain is expected (' + Math.round(input.rainMm) + ' mm in 72 hours).');
  } else {
    parts.push('No rain is expected in 72 hours.');
  }
  const exposureWords = { high: 'many people and roads are nearby', medium: 'some people and roads are nearby', low: 'few people and roads are nearby' };
  parts.push('Flood risk here is ' + level(components.floodRisk) + ' and ' + exposureWords[level(components.exposure)] + '.');
  return parts.join(' ');
}

// input: { condition, ageDays, distinctReporters, rain (0-1), rainMm (number|null), floodRisk, exposure }
function scoreDrain(input) {
  const components = {
    blockage: blockage(input.condition, input.ageDays || 0, input.distinctReporters || 0),
    rain: clamp01(input.rain),
    floodRisk: clamp01(input.floodRisk),
    exposure: clamp01(input.exposure)
  };
  const raw = WEIGHTS.blockage * components.blockage + WEIGHTS.rain * components.rain +
    WEIGHTS.floodRisk * components.floodRisk + WEIGHTS.exposure * components.exposure;
  const score = Math.round(raw * 1000) / 1000;
  return { score, band: band(score), components, explanation: explain(input, components) };
}

// items: [{ id, score, disputed, overrideRank }]. Disputed drains are pinned first.
// A manual override places a drain at its given position among the rest.
function rankDrains(items) {
  const byScore = (a, b) => b.score - a.score || a.id - b.id;
  const disputed = items.filter((d) => d.disputed).sort(byScore);
  const rest = items.filter((d) => !d.disputed);
  const computed = rest.filter((d) => d.overrideRank == null).sort(byScore);
  const manual = rest.filter((d) => d.overrideRank != null).sort((a, b) => a.overrideRank - b.overrideRank || a.id - b.id);
  for (const d of manual) {
    const index = Math.min(Math.max(d.overrideRank - 1, 0), computed.length);
    computed.splice(index, 0, d);
  }
  return disputed.concat(computed);
}

// timesMs and mm are parallel hourly arrays. Looks at the 72 hours from the current hour.
function rainFromHourly(timesMs, mm, nowMs) {
  let sumMm = 0;
  let peakMm = 0;
  let peakAt = null;
  for (let i = 0; i < timesMs.length; i++) {
    const t = timesMs[i];
    const v = Number(mm[i]);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    if (t <= nowMs - HOUR_MS || t >= nowMs + 72 * HOUR_MS) continue;
    sumMm += v;
    if (v > peakMm) { peakMm = v; peakAt = t; }
  }
  const hoursToPeak = peakAt == null ? null : Math.max(0, (peakAt - nowMs) / HOUR_MS);
  return { sumMm: Math.round(sumMm * 10) / 10, peakMm, peakAt, hoursToPeak };
}

// How many drains crews can reach before the rain peak. With no peak in the forecast, use the full 72 hours.
function reachable(capacityPerDay, hoursToPeak) {
  const hours = hoursToPeak == null ? 72 : Math.max(0, hoursToPeak);
  return Math.floor(Math.max(0, capacityPerDay) * hours / 24);
}

function isBlindSpot(floodRisk, daysSinceLastReport) {
  return floodRisk >= 0.6 && (daysSinceLastReport == null || daysSinceLastReport >= 14);
}

function haversineM(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

module.exports = {
  WEIGHTS, CONDITION_VALUE, CONDITION_WORDS, CORROBORATION_BONUS, RAIN_FULL_MM,
  blockage, rainScore, band, scoreDrain, rankDrains, rainFromHourly, reachable, isBlindSpot, haversineM
};

if (require.main === module && process.argv[2] === 'test') {
  const assert = require('assert');
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, (msg || '') + ' expected ' + b + ', got ' + a);

  near(WEIGHTS.blockage + WEIGHTS.rain + WEIGHTS.floodRisk + WEIGHTS.exposure, 1, 'weights sum');

  near(blockage('full', 0, 1), 1);
  near(blockage('full', 14, 1), 0.5);
  near(blockage('full', 100, 1), 0.5, 'age floor');
  near(blockage('partial', 0, 1), 0.5);
  near(blockage('partial', 0, 2), 0.6, 'corroboration bonus');
  near(blockage('full', 0, 3), 1, 'bonus capped at 1');
  near(blockage('clear', 0, 5), 0, 'no bonus for clear');
  near(blockage(null, 0, 0), 0);
  near(blockage('nonsense', 0, 0), 0);

  near(rainScore(0), 0);
  near(rainScore(25), 0.5);
  near(rainScore(80), 1);

  assert.strictEqual(band(0.67), 'high');
  assert.strictEqual(band(0.66), 'medium');
  assert.strictEqual(band(0.41), 'medium');
  assert.strictEqual(band(0.4), 'low');

  const worst = scoreDrain({ condition: 'full', ageDays: 0, distinctReporters: 1, rain: 1, rainMm: 60, floodRisk: 1, exposure: 1 });
  near(worst.score, 1);
  assert.strictEqual(worst.band, 'high');
  assert.ok(worst.explanation.includes('Fully blocked'));
  assert.ok(worst.explanation.includes('Heavy rain'));

  const unknown = scoreDrain({ condition: null, ageDays: 0, distinctReporters: 0, rain: 0, rainMm: null, floodRisk: 0.5, exposure: 0.5 });
  near(unknown.score, 0.2);
  assert.strictEqual(unknown.band, 'low');
  assert.ok(unknown.explanation.includes('No report yet'));

  const crowd = scoreDrain({ condition: 'partial', ageDays: 1, distinctReporters: 3, rain: 0.2, rainMm: 10, floodRisk: 0.5, exposure: 0.5 });
  assert.ok(crowd.explanation.includes('3 people reported this'));

  const ranked = rankDrains([
    { id: 1, score: 0.9, disputed: false, overrideRank: null },
    { id: 2, score: 0.5, disputed: false, overrideRank: null },
    { id: 3, score: 0.2, disputed: false, overrideRank: 1 },
    { id: 4, score: 0.1, disputed: true, overrideRank: null }
  ]);
  assert.deepStrictEqual(ranked.map((d) => d.id), [4, 3, 1, 2]);
  const late = rankDrains([
    { id: 1, score: 0.9, disputed: false, overrideRank: null },
    { id: 2, score: 0.5, disputed: false, overrideRank: 99 }
  ]);
  assert.deepStrictEqual(late.map((d) => d.id), [1, 2], 'override rank is clamped to the list length');

  assert.strictEqual(reachable(8, 12), 4);
  assert.strictEqual(reachable(8, null), 24);
  assert.strictEqual(reachable(8, 0), 0);

  const now = Date.UTC(2026, 5, 1, 12, 30);
  const times = [1, 2, 3, 4].map((h) => now + h * HOUR_MS);
  const rain = rainFromHourly(times, [0, 2, 5, 1], now);
  near(rain.sumMm, 8);
  near(rain.hoursToPeak, 3);
  assert.strictEqual(rain.peakAt, times[2]);
  const dry = rainFromHourly(times, [0, 0, 0, 0], now);
  assert.strictEqual(dry.peakAt, null);
  assert.strictEqual(dry.hoursToPeak, null);
  const old = rainFromHourly([now - 5 * HOUR_MS, now + 80 * HOUR_MS], [9, 9], now);
  near(old.sumMm, 0, 'hours outside the window are ignored');

  assert.strictEqual(isBlindSpot(0.6, null), true);
  assert.strictEqual(isBlindSpot(0.6, 15), true);
  assert.strictEqual(isBlindSpot(0.6, 13), false);
  assert.strictEqual(isBlindSpot(0.5, null), false);

  const metres = haversineM(5.6, -0.19, 5.6001, -0.19);
  assert.ok(metres > 11 && metres < 11.3, 'haversine about 11 m, got ' + metres);

  console.log('scoring.js: all tests passed');
}
