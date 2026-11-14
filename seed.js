'use strict';
const { db, normalizePhone, setSetting, getSetting } = require('./db');

// SAMPLE DATA ONLY. Coordinates are approximate. Replace with field-survey data before real use.
const SAMPLE_LANDMARKS = [
  ['Kwame Nkrumah Circle (SAMPLE)', 5.5700, -0.2163],
  ['Kaneshie Market (SAMPLE)', 5.5665, -0.2370],
  ['Avenor Junction (SAMPLE)', 5.5760, -0.2200],
  ['Alajo Junction (SAMPLE)', 5.5960, -0.2140],
  ['Makola Market (SAMPLE)', 5.5480, -0.2080],
  ['Nima Market (SAMPLE)', 5.5830, -0.1980],
  ['Adabraka Market (SAMPLE)', 5.5620, -0.2110],
  ['Mallam Junction (SAMPLE)', 5.5690, -0.2870],
  ['Dansoman Roundabout (SAMPLE)', 5.5390, -0.2620],
  ['Madina Zongo Junction (SAMPLE)', 5.6690, -0.1660]
];

// SAMPLE drains: [lat, lng, flood_risk, exposure]. Hand-set guesses, not survey results.
const SAMPLE_DRAINS = [
  [5.5704, -0.2158, 0.9, 0.9],
  [5.5668, -0.2365, 0.8, 0.8],
  [5.5764, -0.2204, 0.8, 0.6],
  [5.5956, -0.2136, 0.9, 0.7],
  [5.5484, -0.2084, 0.5, 0.9],
  [5.5834, -0.1976, 0.7, 0.8],
  [5.5694, -0.2866, 0.7, 0.6],
  [5.5394, -0.2616, 0.4, 0.5],
  [5.6694, -0.1656, 0.6, 0.7]
];

const seed = db.transaction(() => {
  const t = Date.now();
  if (db.prepare('SELECT COUNT(*) AS n FROM landmarks').get().n === 0) {
    const add = db.prepare('INSERT INTO landmarks(name, lat, lng, active) VALUES(?, ?, ?, 1)');
    for (const l of SAMPLE_LANDMARKS) add.run(l[0], l[1], l[2]);
    console.log('Added ' + SAMPLE_LANDMARKS.length + ' SAMPLE landmarks.');
  } else {
    console.log('Landmarks already exist. No SAMPLE landmarks added.');
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM drains').get().n === 0) {
    const add = db.prepare('INSERT INTO drains(lat, lng, flood_risk, exposure, created_at) VALUES(?, ?, ?, ?, ?)');
    for (const d of SAMPLE_DRAINS) add.run(d[0], d[1], d[2], d[3], t);
    console.log('Added ' + SAMPLE_DRAINS.length + ' SAMPLE drains.');
  } else {
    console.log('Drains already exist. No SAMPLE drains added.');
  }
  if (getSetting('capacity', null) == null) setSetting('capacity', 10);

  const raw = process.env.ADMIN_PHONE;
  if (!raw) {
    console.warn('ADMIN_PHONE is not set, so no admin was created. Run again like this: ADMIN_PHONE=0241234567 node seed.js');
    return;
  }
  const phone = normalizePhone(raw);
  if (!phone) {
    console.warn('ADMIN_PHONE "' + raw + '" is not a valid Ghana mobile number. No admin was created.');
    return;
  }
  const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (user) db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
  else db.prepare("INSERT INTO users(phone, role, created_at) VALUES(?, 'admin', ?)").run(phone, t);
  console.log('Admin is ' + phone + '. Sign in with this number.');
});

seed();
