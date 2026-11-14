'use strict';
/*
DrainWatch REST API. All routes need "Authorization: Bearer <token>" unless marked public.

AUTH
  POST   /api/auth/request-otp        public    { phone }
  POST   /api/auth/verify             public    { phone, code } -> { token, role }
  GET    /api/me                      any role
SHARED
  GET    /api/landmarks               any role  (admin may add ?all=1 to include inactive)
REPORTER
  POST   /api/reports                 multipart: client_id, condition, lat+lng OR landmark_id, note?, photo?
  GET    /api/reports/mine
  GET    /api/notifications
  POST   /api/notifications/read
  GET    /api/confirmations/pending
  POST   /api/confirmations           { task_id, still_blocked }
  PUT    /api/me/rain-alerts          { landmark_id | null }
CREW
  GET    /api/tasks/mine
  POST   /api/tasks/:id/done          multipart: client_id, photo (required)
ADMIN
  GET    /api/ranking                 ranked drains, rain, capacity cut line, blind spots
  POST   /api/tasks                   { drain_id, crew_id }
  POST   /api/drains/:id/override     { rank, reason }
  DELETE /api/drains/:id/override
  PUT    /api/drains/:id              { flood_risk, exposure }
  GET    /api/review
  POST   /api/reports/:id/review      { condition }
  GET    /api/stats
  GET    /api/export.csv
  GET    /api/crew
  POST   /api/crew                    { phone }
  POST   /api/landmarks               { name, lat, lng }
  PUT    /api/landmarks/:id           { name, lat, lng, active }
  PUT    /api/settings                { capacity }
CREW + ADMIN
  GET    /api/uploads/:name?token=    photo file
*/
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { db, UPLOAD_DIR, getSetting, setSetting, normalizePhone } = require('./db');
const scoring = require('./scoring');

const PORT = Number(process.env.PORT) || 3000;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const CONDITIONS = ['clear', 'partial', 'full'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RAIN_URL = 'https://api.open-meteo.com/v1/forecast?latitude=5.60&longitude=-0.19&hourly=precipitation&forecast_days=4&timezone=GMT';

let SECRET = process.env.TOKEN_SECRET || getSetting('token_secret', null);
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  setSetting('token_secret', SECRET);
}

const q = {
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByPhone: db.prepare('SELECT * FROM users WHERE phone = ?'),
  userAdd: db.prepare('INSERT INTO users(phone, role, created_at) VALUES(?, ?, ?)'),
  userRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
  crewList: db.prepare("SELECT id, phone FROM users WHERE role = 'crew' ORDER BY phone"),
  setRainLandmark: db.prepare('UPDATE users SET rain_landmark_id = ? WHERE id = ?'),
  rainUsers: db.prepare(`SELECT u.id, u.phone, l.name, l.lat, l.lng FROM users u
    JOIN landmarks l ON l.id = u.rain_landmark_id
    WHERE u.last_rain_alert_at IS NULL OR u.last_rain_alert_at <= ?`),
  rainSent: db.prepare('UPDATE users SET last_rain_alert_at = ? WHERE id = ?'),

  otpPut: db.prepare('INSERT OR REPLACE INTO otps(phone, hash, expires_at, attempts) VALUES(?, ?, ?, 0)'),
  otpGet: db.prepare('SELECT * FROM otps WHERE phone = ?'),
  otpDel: db.prepare('DELETE FROM otps WHERE phone = ?'),
  otpMiss: db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?'),
  otpPurge: db.prepare('DELETE FROM otps WHERE expires_at < ?'),

  landmarksActive: db.prepare('SELECT id, name, lat, lng FROM landmarks WHERE active = 1 ORDER BY name'),
  landmarksAll: db.prepare('SELECT id, name, lat, lng, active FROM landmarks ORDER BY name'),
  landmarkById: db.prepare('SELECT * FROM landmarks WHERE id = ?'),
  landmarkAdd: db.prepare('INSERT INTO landmarks(name, lat, lng, active) VALUES(?, ?, ?, 1)'),
  landmarkSet: db.prepare('UPDATE landmarks SET name = ?, lat = ?, lng = ?, active = ? WHERE id = ?'),

  drainsAll: db.prepare('SELECT * FROM drains'),
  drainById: db.prepare('SELECT * FROM drains WHERE id = ?'),
  drainsInBox: db.prepare('SELECT id, lat, lng FROM drains WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?'),
  drainAdd: db.prepare('INSERT INTO drains(lat, lng, created_at) VALUES(?, ?, ?)'),
  drainSet: db.prepare('UPDATE drains SET flood_risk = ?, exposure = ? WHERE id = ?'),

  reportByClient: db.prepare('SELECT * FROM reports WHERE client_id = ?'),
  reportById: db.prepare('SELECT * FROM reports WHERE id = ?'),
  reportAdd: db.prepare(`INSERT INTO reports(client_id, drain_id, user_id, condition, photo, note, needs_review, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)`),
  reportReview: db.prepare('UPDATE reports SET condition = ?, needs_review = 0 WHERE id = ?'),
  lastReport: db.prepare('SELECT condition, note, created_at FROM reports WHERE drain_id = ? ORDER BY created_at DESC, id DESC LIMIT 1'),
  reporters48: db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM reports WHERE drain_id = ? AND created_at >= ?'),
  recentReporters: db.prepare('SELECT DISTINCT user_id FROM reports WHERE drain_id = ? AND created_at >= ? AND created_at <= ?'),
  reportsMine: db.prepare(`SELECT r.id, r.condition, r.created_at, d.id AS drain_id, d.lat, d.lng,
      (SELECT t.status FROM tasks t WHERE t.drain_id = r.drain_id
        AND (t.completed_at IS NULL OR t.completed_at >= r.created_at) ORDER BY t.id DESC LIMIT 1) AS task_status
    FROM reports r JOIN drains d ON d.id = r.drain_id
    WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 100`),
  reviewList: db.prepare(`SELECT r.id, r.condition, r.note, r.created_at, d.id AS drain_id, d.lat, d.lng
    FROM reports r JOIN drains d ON d.id = r.drain_id WHERE r.needs_review = 1 ORDER BY r.id DESC LIMIT 200`),
  countReports: db.prepare('SELECT COUNT(*) AS n FROM reports'),

  taskById: db.prepare('SELECT * FROM tasks WHERE id = ?'),
  lastTask: db.prepare(`SELECT t.*, u.phone AS crew_phone FROM tasks t JOIN users u ON u.id = t.crew_id
    WHERE t.drain_id = ? ORDER BY t.id DESC LIMIT 1`),
  openTask: db.prepare("SELECT * FROM tasks WHERE drain_id = ? AND status IN ('assigned','disputed') ORDER BY id DESC LIMIT 1"),
  taskAdd: db.prepare("INSERT INTO tasks(drain_id, crew_id, status, disputed, created_at) VALUES(?, ?, 'assigned', 0, ?)"),
  taskReassign: db.prepare('UPDATE tasks SET crew_id = ? WHERE id = ?'),
  tasksMine: db.prepare(`SELECT t.id, t.drain_id, t.status, t.created_at, t.completed_at, d.lat, d.lng
    FROM tasks t JOIN drains d ON d.id = t.drain_id
    WHERE t.crew_id = ? AND (t.status IN ('assigned','disputed') OR t.completed_at >= ?) ORDER BY t.id DESC`),
  taskDone: db.prepare("UPDATE tasks SET status = 'done', disputed = 0, after_photo = ?, client_id = ?, completed_at = ? WHERE id = ?"),
  taskVerify: db.prepare("UPDATE tasks SET status = 'verified' WHERE id = ?"),
  taskDispute: db.prepare("UPDATE tasks SET status = 'disputed', disputed = 1, completed_at = NULL WHERE id = ?"),
  autoVerify: db.prepare("UPDATE tasks SET status = 'verified' WHERE status = 'done' AND completed_at <= ?"),
  countCleared: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('done','verified')"),
  avgClear: db.prepare(`SELECT AVG(t.completed_at - (SELECT MIN(r.created_at) FROM reports r
      WHERE r.drain_id = t.drain_id AND r.created_at <= t.completed_at AND r.created_at >= t.completed_at - ?)) AS ms
    FROM tasks t WHERE t.status IN ('done','verified') AND t.completed_at IS NOT NULL`),

  pendingConfirm: db.prepare(`SELECT t.id AS task_id, t.drain_id, t.completed_at, d.lat, d.lng
    FROM tasks t JOIN drains d ON d.id = t.drain_id
    WHERE t.status = 'done'
      AND EXISTS (SELECT 1 FROM reports r WHERE r.drain_id = t.drain_id AND r.user_id = ?
        AND r.created_at <= t.completed_at AND r.created_at >= t.completed_at - ?)
      AND NOT EXISTS (SELECT 1 FROM confirmations c WHERE c.task_id = t.id AND c.user_id = ? AND c.created_at >= t.completed_at)
    ORDER BY t.completed_at`),
  confirmAdd: db.prepare('INSERT INTO confirmations(task_id, user_id, still_blocked, created_at) VALUES(?, ?, ?, ?)'),

  activeOverride: db.prepare('SELECT rank, reason, created_at FROM overrides WHERE drain_id = ? AND active = 1 ORDER BY id DESC LIMIT 1'),
  overrideOff: db.prepare('UPDATE overrides SET active = 0 WHERE drain_id = ? AND active = 1'),
  overrideAdd: db.prepare('INSERT INTO overrides(drain_id, rank, reason, admin_id, active, created_at) VALUES(?, ?, ?, ?, 1, ?)'),

  notifAdd: db.prepare('INSERT INTO notifications(user_id, text, kind, read, created_at) VALUES(?, ?, ?, 0, ?)'),
  notifList: db.prepare('SELECT id, text, kind, read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50'),
  notifUnread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0'),
  notifRead: db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0')
};

const notify = {
  // The single SMS delivery point. Replace the body with an Africa's Talking call for production.
  sendSms(phone, text) {
    console.log('[SMS to ' + phone + '] ' + text);
  },
  inbox(userId, text, kind) {
    q.notifAdd.run(userId, text, kind, Date.now());
  }
};

/* ---------- tokens, OTP, rate limits ---------- */

function hmac(text) {
  return crypto.createHmac('sha256', SECRET).update(text).digest('base64url');
}

function signToken(user) {
  const body = Buffer.from(JSON.stringify({ uid: user.id, exp: Date.now() + 7 * DAY })).toString('base64url');
  return body + '.' + hmac(body);
}

function readToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const given = Buffer.from(parts[1]);
  const expected = Buffer.from(hmac(parts[0]));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (err) {
    return null; // A signed body that is not JSON can only come from a changed secret; treat it as signed out.
  }
  if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
  return data;
}

function otpHash(phone, code) {
  return crypto.createHmac('sha256', SECRET).update(phone + ':' + code).digest('hex');
}

const buckets = new Map();
function hit(key, max, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= t) {
    b = { count: 0, reset: t + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return b.count <= max;
}
setInterval(() => {
  const t = Date.now();
  for (const [key, b] of buckets) if (b.reset <= t) buckets.delete(key);
}, 10 * MIN).unref();

// The role is read from the database on every request, so an invite or a role change takes effect at once.
function auth(allowQueryToken) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    let token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token && allowQueryToken && typeof req.query.token === 'string') token = req.query.token;
    const data = readToken(token);
    const user = data ? q.userById.get(data.uid) : null;
    if (!user) return res.status(401).json({ error: 'auth_required' });
    req.user = user;
    next();
  };
}

function role(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'wrong_role' });
    next();
  };
}

const guard = (...roles) => [auth(false), role(...roles)];

function limitReports(req, res, next) {
  // Two separate calls so both counters always advance.
  const userOk = hit('rep:user:' + req.user.id, 30, HOUR);
  const ipOk = hit('rep:ip:' + req.ip, 120, HOUR);
  if (!userOk || !ipOk) return res.status(429).json({ error: 'rate_limited' });
  next();
}

/* ---------- uploads ---------- */

const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + '.' + IMAGE_EXT[file.mimetype])
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_EXT[file.mimetype]) return cb(null, true);
    const err = new Error('Only images are allowed');
    err.code = 'BAD_IMAGE';
    cb(err);
  }
});

function removeUpload(req) {
  if (!req.file) return;
  const file = req.file.path;
  req.file = null;
  fs.unlink(file, (err) => {
    if (err) console.error('Could not remove unused upload ' + file + ':', err.message);
  });
}

/* ---------- helpers ---------- */

function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string' || v.trim() === '') return NaN;
  return Number(v);
}

function idParam(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'bad_request' });
    return null;
  }
  return id;
}

// Loose Greater Accra box: rejects GPS glitches and junk coordinates.
function inAccra(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 5.3 && lat <= 6.1 && lng >= -0.7 && lng <= 0.3;
}

function unit(v) {
  const n = num(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function placeNamer() {
  const landmarks = q.landmarksActive.all();
  return (place) => {
    let best = null;
    let bestM = Infinity;
    for (const l of landmarks) {
      const m = scoring.haversineM(place.lat, place.lng, l.lat, l.lng);
      if (m < bestM) { bestM = m; best = l; }
    }
    return best ? 'Near ' + best.name : 'Drain ' + (place.drain_id || place.id);
  };
}

function findOrCreateDrain(lat, lng, t) {
  // 0.0002 degrees is about 22 m, so the box always contains the 20 m circle.
  const dLat = 0.0002;
  const dLng = 0.0002 / Math.cos(lat * Math.PI / 180);
  let bestId = null;
  let bestM = 20;
  for (const d of q.drainsInBox.all(lat - dLat, lat + dLat, lng - dLng, lng + dLng)) {
    const m = scoring.haversineM(lat, lng, d.lat, d.lng);
    if (m <= bestM) { bestM = m; bestId = d.id; }
  }
  if (bestId != null) return bestId;
  return Number(q.drainAdd.run(lat, lng, t).lastInsertRowid);
}

const saveReport = db.transaction((userId, f) => {
  const drainId = findOrCreateDrain(f.lat, f.lng, f.t);
  const info = q.reportAdd.run(f.client_id, drainId, userId, f.condition, f.photo, f.note, f.photo ? 0 : 1, f.t);
  return { id: Number(info.lastInsertRowid), drain_id: drainId };
});

// One state object per drain. A crew "done" newer than the last report counts as a "clear" observation.
function drainStates(nowMs) {
  const name = placeNamer();
  return q.drainsAll.all().map((d) => {
    const last = q.lastReport.get(d.id);
    const task = q.lastTask.get(d.id);
    const override = q.activeOverride.get(d.id);
    let condition = last ? last.condition : null;
    let observedAt = last ? last.created_at : null;
    let reporters = q.reporters48.get(d.id, nowMs - 48 * HOUR).n;
    const cleared = !!task && (task.status === 'done' || task.status === 'verified') &&
      task.completed_at != null && (!last || task.completed_at >= last.created_at);
    if (cleared) {
      condition = 'clear';
      observedAt = task.completed_at;
      reporters = 0;
    }
    return {
      id: d.id, lat: d.lat, lng: d.lng, name: name(d),
      flood_risk: d.flood_risk, exposure: d.exposure,
      condition, observed_at: observedAt, last_report_at: last ? last.created_at : null,
      reporters, cleared,
      disputed: !!task && task.status === 'disputed',
      open_blocked: !cleared && (condition === 'partial' || condition === 'full'),
      task: task ? { id: task.id, status: task.status, crew_id: task.crew_id, crew_phone: task.crew_phone, after_photo: task.after_photo, completed_at: task.completed_at } : null,
      override: override || null
    };
  });
}

function buildRanking(nowMs, rain) {
  const scored = drainStates(nowMs).map((s) => {
    const r = scoring.scoreDrain({
      condition: s.condition,
      ageDays: s.observed_at == null ? 0 : (nowMs - s.observed_at) / DAY,
      distinctReporters: s.reporters,
      rain: rain.score, rainMm: rain.sum_mm,
      floodRisk: s.flood_risk, exposure: s.exposure
    });
    return Object.assign(s, { score: r.score, band: r.band, components: r.components, explanation: r.explanation, overrideRank: s.override ? s.override.rank : null });
  });
  const ranked = scoring.rankDrains(scored);
  const capacity = Number(getSetting('capacity', '10'));
  const reach = scoring.reachable(capacity, rain.hours_to_peak);
  let open = 0;
  let cutIndex = -1;
  ranked.forEach((d, i) => {
    d.position = i + 1;
    if (!d.cleared) {
      open += 1;
      if (open === reach) cutIndex = i;
    }
  });
  if (reach > open) cutIndex = ranked.length - 1;
  const blindSpots = ranked
    .filter((d) => scoring.isBlindSpot(d.flood_risk, d.last_report_at == null ? null : (nowMs - d.last_report_at) / DAY))
    .map((d) => ({ id: d.id, name: d.name, flood_risk: d.flood_risk, last_report_at: d.last_report_at }));
  return { rain, capacity, reach, cut_index: cutIndex, drains: ranked, blind_spots: blindSpots };
}

/* ---------- rain (Open-Meteo, 30 minute cache, last good value as fallback) ---------- */

const rainCache = { value: null, fetchedAt: 0, savedAt: 0, nextTry: 0 };
const savedRain = getSetting('rain_last', null);
if (savedRain) {
  try {
    const parsed = JSON.parse(savedRain);
    rainCache.value = parsed.value;
    // fetchedAt stays 0 in memory so the first request tries a fresh fetch; the saved time is only for display.
    rainCache.savedAt = parsed.fetchedAt;
  } catch (err) {
    console.error('Saved rain value could not be read; starting without one:', err.message);
  }
}

function presentRain(stale) {
  const v = rainCache.value;
  if (!v) return { score: 0, sum_mm: null, peak_at: null, peak_mm: null, hours_to_peak: null, stale: true, fetched_at: null };
  const t = Date.now();
  const peakAhead = v.peak_at != null && v.peak_at > t - HOUR;
  return {
    score: v.score, sum_mm: v.sum_mm,
    peak_at: peakAhead ? v.peak_at : null,
    peak_mm: peakAhead ? v.peak_mm : null,
    hours_to_peak: peakAhead ? Math.max(0, (v.peak_at - t) / HOUR) : null,
    stale,
    fetched_at: rainCache.fetchedAt || rainCache.savedAt || null
  };
}

async function getRain() {
  const t = Date.now();
  if (rainCache.value && rainCache.fetchedAt && t - rainCache.fetchedAt < 30 * MIN) return presentRain(false);
  if (t < rainCache.nextTry) return presentRain(true);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(RAIN_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error('Open-Meteo answered HTTP ' + res.status);
    const data = await res.json();
    const hourly = data && data.hourly;
    if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.precipitation)) throw new Error('Open-Meteo sent an unexpected shape');
    const info = scoring.rainFromHourly(hourly.time.map((s) => Date.parse(s + 'Z')), hourly.precipitation, t);
    rainCache.value = { score: scoring.rainScore(info.sumMm), sum_mm: info.sumMm, peak_at: info.peakAt, peak_mm: info.peakMm };
    rainCache.fetchedAt = t;
    setSetting('rain_last', JSON.stringify({ value: rainCache.value, fetchedAt: t }));
    return presentRain(false);
  } catch (err) {
    console.error('Rain forecast fetch failed, using the last good value:', err.message);
    rainCache.nextTry = t + 5 * MIN;
    return presentRain(true);
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- app ---------- */

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '20kb' }));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/* ----- auth ----- */

app.post('/api/auth/request-otp', (req, res) => {
  const phone = normalizePhone(req.body && req.body.phone);
  if (!phone) return res.status(400).json({ error: 'bad_phone' });
  const ipOk = hit('otp:ip:' + req.ip, 20, 10 * MIN);
  const phoneOk = hit('otp:phone:' + phone, 3, 10 * MIN);
  if (!ipOk || !phoneOk) return res.status(429).json({ error: 'rate_limited' });
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  q.otpPut.run(phone, otpHash(phone, code), Date.now() + 10 * MIN);
  notify.sendSms(phone, 'Your DrainWatch code is ' + code + '. It works for 10 minutes.');
  res.json({ ok: true });
});

app.post('/api/auth/verify', (req, res) => {
  const phone = normalizePhone(req.body && req.body.phone);
  const code = String((req.body && req.body.code) || '').trim();
  if (!phone || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'bad_code' });
  const ipOk = hit('verify:ip:' + req.ip, 30, 10 * MIN);
  const phoneOk = hit('verify:phone:' + phone, 15, 10 * MIN);
  if (!ipOk || !phoneOk) return res.status(429).json({ error: 'rate_limited' });
  const row = q.otpGet.get(phone);
  if (!row || row.expires_at < Date.now()) {
    if (row) q.otpDel.run(phone);
    return res.status(400).json({ error: 'expired_code' });
  }
  if (row.attempts >= 5) {
    q.otpDel.run(phone);
    return res.status(400).json({ error: 'too_many_attempts' });
  }
  const match = crypto.timingSafeEqual(Buffer.from(row.hash, 'hex'), Buffer.from(otpHash(phone, code), 'hex'));
  if (!match) {
    if (row.attempts + 1 >= 5) {
      q.otpDel.run(phone);
      return res.status(400).json({ error: 'too_many_attempts' });
    }
    q.otpMiss.run(phone);
    return res.status(400).json({ error: 'bad_code' });
  }
  q.otpDel.run(phone);
  let user = q.userByPhone.get(phone);
  if (!user) {
    q.userAdd.run(phone, 'reporter', Date.now());
    user = q.userByPhone.get(phone);
  }
  res.json({ token: signToken(user), role: user.role });
});

app.get('/api/me', guard('reporter', 'crew', 'admin'), (req, res) => {
  res.json({ id: req.user.id, phone: req.user.phone, role: req.user.role, rain_landmark_id: req.user.rain_landmark_id });
});

/* ----- landmarks ----- */

app.get('/api/landmarks', guard('reporter', 'crew', 'admin'), (req, res) => {
  const all = req.user.role === 'admin' && req.query.all === '1';
  res.json(all ? q.landmarksAll.all() : q.landmarksActive.all());
});

function readLandmark(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const lat = num(body.lat);
  const lng = num(body.lng);
  if (name.length < 2 || name.length > 80 || !inAccra(lat, lng)) return null;
  return { name, lat, lng };
}

app.post('/api/landmarks', guard('admin'), (req, res) => {
  const lm = readLandmark(req.body || {});
  if (!lm) return res.status(400).json({ error: 'bad_landmark' });
  const info = q.landmarkAdd.run(lm.name, lm.lat, lm.lng);
  res.json({ id: Number(info.lastInsertRowid) });
});

app.put('/api/landmarks/:id', guard('admin'), (req, res) => {
  const id = idParam(req, res);
  if (id == null) return;
  if (!q.landmarkById.get(id)) return res.status(404).json({ error: 'not_found' });
  const lm = readLandmark(req.body || {});
  if (!lm) return res.status(400).json({ error: 'bad_landmark' });
  q.landmarkSet.run(lm.name, lm.lat, lm.lng, req.body.active === false ? 0 : 1, id);
  res.json({ ok: true });
});

/* ----- reporter ----- */

app.post('/api/reports', guard('reporter'), limitReports, upload.single('photo'), (req, res) => {
  const b = req.body || {};
  const fail = (code) => {
    removeUpload(req);
    res.status(400).json({ error: code });
  };
  if (typeof b.client_id !== 'string' || !UUID.test(b.client_id)) return fail('bad_request');

  const answerDuplicate = (existing) => {
    removeUpload(req);
    if (existing.user_id !== req.user.id) return res.status(409).json({ error: 'conflict' });
    res.json({ id: existing.id, drain_id: existing.drain_id, duplicate: true });
  };
  const existing = q.reportByClient.get(b.client_id);
  if (existing) return answerDuplicate(existing);

  if (!CONDITIONS.includes(b.condition)) return fail('bad_condition');
  let lat;
  let lng;
  if (b.landmark_id !== undefined && b.landmark_id !== '') {
    const landmarkId = Number(b.landmark_id);
    const lm = Number.isInteger(landmarkId) ? q.landmarkById.get(landmarkId) : null;
    if (!lm || !lm.active) return fail('bad_location');
    lat = lm.lat;
    lng = lm.lng;
  } else {
    lat = num(b.lat);
    lng = num(b.lng);
    if (!inAccra(lat, lng)) return fail('bad_location');
  }
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : '';
  try {
    const saved = saveReport(req.user.id, {
      client_id: b.client_id, condition: b.condition, lat, lng, note,
      photo: req.file ? req.file.filename : null, t: Date.now()
    });
    res.json({ id: saved.id, drain_id: saved.drain_id, duplicate: false });
  } catch (err) {
    // Two retries of the same report can race; the UNIQUE client_id makes the second one land here.
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const winner = q.reportByClient.get(b.client_id);
      if (winner) return answerDuplicate(winner);
    }
    removeUpload(req);
    throw err;
  }
});

app.get('/api/reports/mine', guard('reporter'), (req, res) => {
  const name = placeNamer();
  const statusFor = { assigned: 'scheduled', done: 'cleared', verified: 'cleared', disputed: 'disputed' };
  res.json(q.reportsMine.all(req.user.id).map((r) => ({
    id: r.id, condition: r.condition, created_at: r.created_at, name: name(r),
    status: statusFor[r.task_status] || 'received'
  })));
});

app.get('/api/notifications', guard('reporter'), (req, res) => {
  res.json({ unread: q.notifUnread.get(req.user.id).n, items: q.notifList.all(req.user.id) });
});

app.post('/api/notifications/read', guard('reporter'), (req, res) => {
  q.notifRead.run(req.user.id);
  res.json({ ok: true });
});

app.get('/api/confirmations/pending', guard('reporter'), (req, res) => {
  q.autoVerify.run(Date.now() - 48 * HOUR);
  const name = placeNamer();
  res.json(q.pendingConfirm.all(req.user.id, 30 * DAY, req.user.id).map((t) => ({ task_id: t.task_id, name: name(t), completed_at: t.completed_at })));
});

const saveConfirmation = db.transaction((taskId, userId, stillBlocked, t) => {
  q.confirmAdd.run(taskId, userId, stillBlocked ? 1 : 0, t);
  if (stillBlocked) q.taskDispute.run(taskId);
  else q.taskVerify.run(taskId);
});

app.post('/api/confirmations', guard('reporter'), (req, res) => {
  const b = req.body || {};
  if (!Number.isInteger(b.task_id) || typeof b.still_blocked !== 'boolean') return res.status(400).json({ error: 'bad_request' });
  q.autoVerify.run(Date.now() - 48 * HOUR);
  const pending = q.pendingConfirm.all(req.user.id, 30 * DAY, req.user.id).find((t) => t.task_id === b.task_id);
  if (!pending) return res.status(404).json({ error: 'confirm_closed' });
  saveConfirmation(b.task_id, req.user.id, b.still_blocked, Date.now());
  if (b.still_blocked) {
    const task = q.taskById.get(b.task_id);
    const crew = q.userById.get(task.crew_id);
    const place = placeNamer()(pending);
    if (crew) notify.sendSms(crew.phone, 'DrainWatch: a resident says the drain ' + place + ' is still blocked. The task is open again. Please check it.');
  }
  res.json({ ok: true });
});

app.put('/api/me/rain-alerts', guard('reporter'), (req, res) => {
  const id = req.body ? req.body.landmark_id : undefined;
  if (id === null) {
    q.setRainLandmark.run(null, req.user.id);
    return res.json({ ok: true });
  }
  const lm = Number.isInteger(id) ? q.landmarkById.get(id) : null;
  if (!lm || !lm.active) return res.status(400).json({ error: 'bad_location' });
  q.setRainLandmark.run(id, req.user.id);
  res.json({ ok: true });
});

/* ----- crew ----- */

app.get('/api/tasks/mine', guard('crew'), (req, res) => {
  const name = placeNamer();
  res.json(q.tasksMine.all(req.user.id, Date.now() - 7 * DAY).map((t) => {
    const last = q.lastReport.get(t.drain_id);
    return {
      id: t.id, status: t.status, lat: t.lat, lng: t.lng, name: name(t),
      condition: last ? last.condition : null, note: last ? last.note : '',
      created_at: t.created_at, completed_at: t.completed_at
    };
  }));
});

app.post('/api/tasks/:id/done', guard('crew'), upload.single('photo'), (req, res) => {
  const id = idParam(req, res);
  if (id == null) return removeUpload(req);
  const clientId = req.body && req.body.client_id;
  const stop = (status, code) => {
    removeUpload(req);
    res.status(status).json({ error: code });
  };
  if (typeof clientId !== 'string' || !UUID.test(clientId)) return stop(400, 'bad_request');
  const task = q.taskById.get(id);
  if (!task || task.crew_id !== req.user.id) return stop(404, 'not_found');
  if (task.client_id === clientId && (task.status === 'done' || task.status === 'verified')) {
    removeUpload(req);
    return res.json({ ok: true, duplicate: true });
  }
  if (task.status !== 'assigned' && task.status !== 'disputed') return stop(409, 'task_closed');
  if (!req.file) return stop(400, 'photo_required');
  const t = Date.now();
  q.taskDone.run(req.file.filename, clientId, t, id);
  const drain = q.drainById.get(task.drain_id);
  const place = placeNamer()(drain);
  for (const r of q.recentReporters.all(task.drain_id, t - 30 * DAY, t)) {
    notify.inbox(r.user_id, 'A crew marked the drain ' + place + ' as cleared. Please tell us if it is clear now.', 'cleared');
  }
  res.json({ ok: true, duplicate: false });
});

/* ----- admin ----- */

app.get('/api/ranking', guard('admin'), wrap(async (req, res) => {
  const t = Date.now();
  q.autoVerify.run(t - 48 * HOUR);
  const rain = await getRain();
  res.json(buildRanking(t, rain));
}));

app.post('/api/tasks', guard('admin'), (req, res) => {
  const b = req.body || {};
  if (!Number.isInteger(b.drain_id) || !Number.isInteger(b.crew_id)) return res.status(400).json({ error: 'bad_request' });
  const drain = q.drainById.get(b.drain_id);
  const crew = q.userById.get(b.crew_id);
  if (!drain) return res.status(404).json({ error: 'not_found' });
  if (!crew || crew.role !== 'crew') return res.status(400).json({ error: 'bad_crew' });
  const t = Date.now();
  const open = q.openTask.get(b.drain_id);
  if (open) q.taskReassign.run(b.crew_id, open.id);
  else q.taskAdd.run(b.drain_id, b.crew_id, t);
  const place = placeNamer()(drain);
  notify.sendSms(crew.phone, 'DrainWatch: you have a drain to clear ' + place + '. Open the app to see your tasks.');
  if (!open) {
    for (const r of q.recentReporters.all(b.drain_id, t - 30 * DAY, t)) {
      notify.inbox(r.user_id, 'A crew is scheduled to clear the drain ' + place + '. We will tell you when it is done.', 'scheduled');
    }
  }
  res.json({ ok: true });
});

const saveOverride = db.transaction((drainId, rank, reason, adminId, t) => {
  q.overrideOff.run(drainId);
  q.overrideAdd.run(drainId, rank, reason, adminId, t);
});

app.post('/api/drains/:id/override', guard('admin'), (req, res) => {
  const id = idParam(req, res);
  if (id == null) return;
  const b = req.body || {};
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!Number.isInteger(b.rank) || b.rank < 1 || b.rank > 10000) return res.status(400).json({ error: 'bad_rank' });
  if (reason.length < 3 || reason.length > 300) return res.status(400).json({ error: 'reason_required' });
  if (!q.drainById.get(id)) return res.status(404).json({ error: 'not_found' });
  saveOverride(id, b.rank, reason, req.user.id, Date.now());
  res.json({ ok: true });
});

app.delete('/api/drains/:id/override', guard('admin'), (req, res) => {
  const id = idParam(req, res);
  if (id == null) return;
  q.overrideOff.run(id);
  res.json({ ok: true });
});

app.put('/api/drains/:id', guard('admin'), (req, res) => {
  const id = idParam(req, res);
  if (id == null) return;
  const floodRisk = unit(req.body && req.body.flood_risk);
  const exposure = unit(req.body && req.body.exposure);
  if (floodRisk == null || exposure == null) return res.status(400).json({ error: 'bad_scores' });
  if (!q.drainById.get(id)) return res.status(404).json({ error: 'not_found' });
  q.drainSet.run(floodRisk, exposure, id);
  res.json({ ok: true });
});

app.get('/api/review', guard('admin'), (req, res) => {
  const name = placeNamer();
  res.json(q.reviewList.all().map((r) => ({ id: r.id, drain_id: r.drain_id, name: name(r), condition: r.condition, note: r.note, created_at: r.created_at })));
});

app.post('/api/reports/:id/review', guard('admin'), (req, res) => {
  const id = idParam(req, res);
  if (id == null) return;
  const condition = req.body && req.body.condition;
  if (!CONDITIONS.includes(condition)) return res.status(400).json({ error: 'bad_condition' });
  if (!q.reportById.get(id)) return res.status(404).json({ error: 'not_found' });
  q.reportReview.run(condition, id);
  res.json({ ok: true });
});

app.get('/api/stats', guard('admin'), (req, res) => {
  const t = Date.now();
  q.autoVerify.run(t - 48 * HOUR);
  const avg = q.avgClear.get(30 * DAY).ms;
  res.json({
    reports_received: q.countReports.get().n,
    drains_cleared: q.countCleared.get().n,
    avg_hours_to_clear: avg == null ? null : Math.round(avg / HOUR * 10) / 10,
    blocked_before_peak: drainStates(t).filter((s) => s.open_blocked).length
  });
});

// Text cells that start with = + - @ get a leading apostrophe so spreadsheets do not run them as formulas.
// Numbers are written raw: they come from our own columns, and prefixing would break negative longitudes.
function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

app.get('/api/export.csv', guard('admin'), wrap(async (req, res) => {
  const t = Date.now();
  q.autoVerify.run(t - 48 * HOUR);
  const data = buildRanking(t, await getRain());
  const rows = [['position', 'drain_id', 'place', 'lat', 'lng', 'priority', 'score', 'condition', 'people_reporting_48h', 'task_status', 'crew_phone', 'rank_set_by_hand', 'override_reason', 'flood_risk', 'exposure', 'why']];
  for (const d of data.drains) {
    rows.push([d.position, d.id, d.name, d.lat, d.lng, d.band, d.score, d.condition || 'no report', d.reporters,
      d.task ? d.task.status : '', d.task ? d.task.crew_phone : '', d.override ? 'yes' : 'no', d.override ? d.override.reason : '',
      d.flood_risk, d.exposure, d.explanation]);
  }
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="drainwatch-ranking.csv"');
  res.send(rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n');
}));

app.get('/api/crew', guard('admin'), (req, res) => {
  res.json(q.crewList.all());
});

app.post('/api/crew', guard('admin'), (req, res) => {
  const phone = normalizePhone(req.body && req.body.phone);
  if (!phone) return res.status(400).json({ error: 'bad_phone' });
  const user = q.userByPhone.get(phone);
  if (user && user.role === 'admin') return res.status(400).json({ error: 'bad_crew' });
  if (user) q.userRole.run('crew', user.id);
  else q.userAdd.run(phone, 'crew', Date.now());
  notify.sendSms(phone, 'You have been added to DrainWatch as a crew member. Sign in with this phone number to see your tasks.');
  res.json({ ok: true });
});

app.put('/api/settings', guard('admin'), (req, res) => {
  const capacity = req.body && req.body.capacity;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) return res.status(400).json({ error: 'bad_capacity' });
  setSetting('capacity', capacity);
  res.json({ ok: true });
});

/* ----- photos: crew and admin only; the token travels in the query so a plain link can open the image ----- */

app.get('/api/uploads/:name', auth(true), role('crew', 'admin'), (req, res, next) => {
  if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(req.params.name)) return res.status(400).json({ error: 'bad_request' });
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(req.params.name, { root: UPLOAD_DIR }, (err) => {
    if (!err) return;
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'not_found' });
    next(err);
  });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

app.use((err, req, res, next) => {
  removeUpload(req);
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'photo_too_large' : 'bad_upload' });
  if (err.code === 'BAD_IMAGE') return res.status(400).json({ error: 'bad_image' });
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'bad_request' });
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

/* ---------- hourly job: auto-verify, OTP cleanup, rain-eve alerts ---------- */

async function rainEveAlerts() {
  const rain = await getRain();
  const t = Date.now();
  // A forecast older than 6 hours is too weak a reason to text people.
  if (rain.score < 0.5 || !rain.fetched_at || t - rain.fetched_at > 6 * HOUR) return;
  const users = q.rainUsers.all(t - DAY);
  if (!users.length) return;
  const blocked = drainStates(t).filter((s) => s.open_blocked);
  for (const u of users) {
    const n = blocked.filter((s) => scoring.haversineM(u.lat, u.lng, s.lat, s.lng) <= 500).length;
    const count = n === 0 ? 'No blocked drains are reported' : n === 1 ? '1 blocked drain is still open' : n + ' blocked drains are still open';
    const text = 'Heavy rain is expected in Accra. ' + count + ' near ' + u.name + '. If you see a blocked drain, report it in DrainWatch.';
    notify.inbox(u.id, text, 'rain');
    notify.sendSms(u.phone, text);
    q.rainSent.run(t, u.id);
  }
}

async function hourlyJob() {
  try {
    q.autoVerify.run(Date.now() - 48 * HOUR);
    q.otpPurge.run(Date.now());
    await rainEveAlerts();
  } catch (err) {
    console.error('Hourly job failed:', err);
  }
}

app.listen(PORT, () => {
  console.log('DrainWatch is running on http://localhost:' + PORT);
  hourlyJob();
  setInterval(hourlyJob, HOUR);
});
