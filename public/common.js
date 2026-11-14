'use strict';
const DW = (() => {
  const S = {
    conditions: { clear: 'Clear', partial: 'Partly blocked', full: 'Fully blocked' },
    bands: { high: 'High', medium: 'Medium', low: 'Low' },
    errors: {
      generic: 'Something went wrong. Please try again.',
      network: 'No connection right now. Check your data and try again.',
      server_error: 'The server had a problem. Please try again in a few minutes.',
      rate_limited: 'Too many tries. Wait 10 minutes, then try again.',
      bad_phone: 'That phone number does not look right. Enter a Ghana mobile number, like 024 123 4567.',
      bad_code: 'That code is not right. Check the text message and enter the 6 numbers again.',
      expired_code: 'That code has run out. Press "Send a new code" to get another one.',
      too_many_attempts: 'Too many wrong codes. Press "Send a new code" to get another one.',
      bad_request: 'Some details were missing. Please fill in the form again.',
      bad_condition: 'Choose how the drain is: clear, partly blocked or fully blocked.',
      bad_location: 'That place is outside Accra or is not on our list. Choose a landmark from the list.',
      bad_image: 'That file is not a photo. Choose a photo and try again.',
      bad_upload: 'The photo could not be sent. Choose it again and try once more.',
      photo_too_large: 'That photo is too big. Take a new photo and try again.',
      photo_required: 'Add a photo of the cleared drain, then press "Mark as done".',
      task_closed: 'This task is already closed. Go back to your task list.',
      not_found: 'We could not find that. Refresh the page and try again.',
      conflict: 'This was already sent from another account. Fill in a new report.',
      confirm_closed: 'This drain no longer needs your answer. Thank you.',
      wrong_role: 'Your account cannot do that. Please sign in again.',
      bad_crew: 'Choose a crew member from the list.',
      bad_rank: 'Enter a rank number of 1 or more.',
      reason_required: 'Write a short reason for the new rank, then save again.',
      bad_scores: 'Flood risk and exposure must be numbers from 0 to 1.',
      bad_landmark: 'Check the landmark name and its latitude and longitude, then save again.',
      bad_capacity: 'Enter a whole number from 1 to 500 for crew capacity.',
      queue_storage: 'This phone could not save your work. Stay online and try again.'
    },
    queue: {
      synced: () => 'Everything is sent.',
      syncing: (n) => 'Sending ' + n + (n === 1 ? ' saved item' : ' saved items') + ' now.',
      offline: (n) => n + (n === 1 ? ' item is' : ' items are') + ' saved on this phone. They will send by themselves when you are back online.'
    },
    queueSent: 'Everything saved on this phone has been sent.',
    queueRejected: 'One saved item could not be accepted and was removed.',

    codeSent: 'We sent a 6-number code by text message. Enter it below.',
    signingIn: 'Code accepted. Opening DrainWatch.',

    chooseLandmark: 'Choose a landmark',
    noRainAlerts: 'No rain alerts',
    landmarksFailed: 'The landmark list could not load. Use your current location, or try again when you are online.',
    gpsFinding: 'Finding your location. This can take up to 15 seconds.',
    gpsGood: (m) => 'Location found, correct to about ' + m + ' metres. You can send your report.',
    gpsWeak: (m) => 'Your location is only correct to about ' + m + ' metres. It is better to choose a landmark from the list instead.',
    gpsDenied: 'Location is turned off for this app. Choose a landmark from the list instead.',
    gpsTimeout: 'We could not find your location. Choose a landmark from the list instead.',
    gpsUnsupported: 'This phone cannot share its location here. Choose a landmark from the list instead.',
    usingLandmark: 'Using the landmark you chose.',
    speakStart: 'Speak your description',
    speakStop: 'Stop listening',
    speechHeard: (text) => 'Added to your note: ' + text,
    micDenied: 'The microphone is turned off for this app. Type your note instead.',
    speechFailed: 'We could not hear you. Try again, or type your note instead.',
    needCondition: 'Choose how the drain is: clear, partly blocked or fully blocked.',
    needLocation: 'Tell us where the drain is. Press "Use my current location" or choose a landmark.',
    photoUnreadable: 'The photo could not be read, so the report was saved without it.',
    reportSending: 'Report saved. Sending it now.',
    reportSavedOffline: 'Report saved on this phone. It will send by itself when you are back online. You do not need to do anything.',
    reportSent: 'Report sent. Open "My reports" to follow it.',
    mineOffline: 'You are offline. This list shows what was loaded last time.',
    mineEmpty: 'You have not sent any reports yet. Open "Report a drain" to send one.',
    reportStatus: {
      waiting: 'Waiting to send. It will send when you are back online.',
      received: 'Received. The assembly can see it.',
      scheduled: 'Scheduled. A crew has been asked to clear it.',
      cleared: 'Cleared. A crew marked this drain as cleared.',
      disputed: 'Still blocked. A resident said it is not clear, so the crew must come back.'
    },
    reportLine: (condition, time) => condition + ', reported ' + time,
    waitingPlace: 'Saved report',
    alertsEmpty: 'You have no messages yet. Messages about your reports will show here.',
    alertsFailed: 'Messages could not load. Check your connection and open this page again.',
    alertKinds: { cleared: 'Drain cleared', scheduled: 'Crew scheduled', rain: 'Rain alert' },
    rainSaved: 'Rain alerts saved. We will message you before heavy rain.',
    rainOff: 'Rain alerts are turned off.',
    confirmAsk: (name) => 'A crew says the drain ' + name + ' is cleared. Is it clear now?',
    confirmThanksYes: 'Thank you. The drain is marked as cleared.',
    confirmThanksNo: 'Thank you. The crew has been told the drain is still blocked.',

    tasksOffline: 'You are offline. This list shows the tasks loaded last time.',
    tasksEmpty: 'You have no tasks right now. New tasks will show here.',
    taskStatus: {
      assigned: 'To do',
      disputed: 'Still blocked. A resident says it is not clear. Please go back.',
      done: 'Done. Waiting for a resident to confirm.',
      verified: 'Done and confirmed.',
      queued: 'Done. Saved on this phone and waiting to send.'
    },
    taskCondition: (c) => 'Last report: ' + c + '.',
    taskNote: (n) => 'Reporter note: ' + n,
    taskMissing: 'That task is not in your list. Go back to your tasks.',
    needAfterPhoto: 'Add a photo of the cleared drain first. Press "Add after-photo".',
    photoUnreadableRetry: 'The photo could not be read. Take the photo again.',
    doneSending: 'Task saved as done. Sending it now.',
    doneSavedOffline: 'Task saved as done on this phone. It will send by itself when you are back online.',

    rainFresh: (mm) => 'Rain expected in the next 72 hours: ' + mm + ' mm.',
    rainPeak: (time, hours) => 'The heaviest rain is expected ' + time + ', about ' + hours + (hours === 1 ? ' hour' : ' hours') + ' from now.',
    rainNoPeak: 'No rain is expected in the next 72 hours.',
    rainStale: (time) => 'The rain forecast could not be updated. These numbers are from ' + time + ' and may be out of date.',
    rainMissing: 'No rain forecast is available right now, so rain is counted as zero. The list will update when the forecast returns.',
    cutLine: (n) => 'Crews can reach ' + n + ' drains before peak rain. Drains below this line are at risk.',
    rankingEmpty: 'No drains yet. Drains show here after the first report.',
    priorityLine: (band, score) => 'Priority: ' + band + ' (score ' + score.toFixed(2) + ').',
    peopleReported: (n) => n + ' people reported this.',
    disputedFlag: 'A resident says this drain is still blocked after the crew visit. It is pinned to the top.',
    overrideFlag: (rank, reason) => 'Rank set by hand to ' + rank + '. Reason: ' + reason,
    taskNone: 'No crew assigned yet.',
    taskAssigned: (phone) => 'Assigned to ' + phone + '.',
    taskDoneWaiting: (phone) => 'Marked as done by ' + phone + '. Waiting for a resident to confirm.',
    taskVerified: (phone) => 'Cleared by ' + phone + ' and confirmed.',
    taskDisputed: (phone) => 'Reopened. Assigned to ' + phone + '.',
    viewAfterPhoto: 'View after-photo',
    assignLabel: (name) => 'Crew member for the drain ' + name,
    chooseCrew: 'Choose a crew member',
    assignButton: 'Assign crew',
    needCrew: 'Choose a crew member first, then press "Assign crew".',
    assigned: 'Crew assigned. They have been sent a text message.',
    editSummary: 'Change rank or scores',
    rankLabel: 'New rank (1 is the top)',
    reasonLabel: 'Reason for the new rank',
    saveRank: 'Save rank',
    removeRank: 'Remove hand-set rank',
    rankSaved: 'Rank saved. The list has been updated.',
    rankRemoved: 'Hand-set rank removed. The list has been updated.',
    floodLabel: 'Flood risk (0 to 1)',
    exposureLabel: 'Exposure (0 to 1)',
    saveScores: 'Save scores',
    scoresSaved: 'Scores saved. The list has been updated.',
    capacitySaved: 'Crew capacity saved. The cut line has been updated.',
    listRefreshed: 'The list has been refreshed.',
    mapUnavailable: 'The map could not load. The ranked list above has all the same information.',
    blindEmpty: 'No blind spots right now.',
    blindLine: (name, risk, last) => name + '. Needs a crew survey. Flood risk ' + risk.toFixed(2) + '. ' + (last ? 'Last report ' + last + '.' : 'No report yet.'),
    reviewEmpty: 'No reports are waiting for review.',
    reviewLine: (name, condition, time) => name + ': ' + condition + ', reported ' + time + ', no photo.',
    reviewNote: (note) => 'Note: ' + note,
    reviewLabel: (name) => 'Correct condition for the report ' + name,
    reviewButton: 'Confirm report',
    reviewSaved: 'Report confirmed. It has left the review list.',
    avgHours: (h) => h + (h === 1 ? ' hour' : ' hours'),
    avgNone: 'No drains cleared yet',
    exportReady: 'The file has been made. Check your downloads.',
    crewEmpty: 'No crew members yet. Invite one with the form above.',
    crewInvited: 'Crew member added. They have been sent a text message.',
    landmarkLine: (l) => l.name + ' (' + l.lat + ', ' + l.lng + ')' + (l.active ? '' : ' – hidden from reporters'),
    landmarkEdit: (name) => 'Edit ' + name,
    landmarkEditing: (name) => 'Editing ' + name + '. Change the details, then press "Save landmark".',
    landmarkSaved: 'Landmark saved.',
    addLandmark: 'Add landmark',
    saveLandmark: 'Save landmark'
  };

  const TOKEN_KEY = 'dw_token';
  const ROLE_KEY = 'dw_role';
  const ALOUD_KEY = 'dw_read_aloud';
  const HOME = { reporter: 'index.html', crew: 'crew.html', admin: 'admin.html' };

  const store = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch (err) {
        console.warn('Storage read failed for ' + key, err);
        return null;
      }
    },
    set(key, value) {
      try {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch (err) {
        console.warn('Storage write failed for ' + key, err);
      }
    },
    getJson(key, fallback) {
      const raw = store.get(key);
      if (!raw) return fallback;
      try {
        return JSON.parse(raw);
      } catch (err) {
        console.warn('Saved data for ' + key + ' was damaged and is ignored', err);
        return fallback;
      }
    }
  };

  // The one place status messages go: the live region, and speech if the user turned it on.
  function say(text) {
    const box = document.getElementById('status');
    if (!box) return;
    // Clearing first makes screen readers announce the same message twice in a row.
    box.textContent = '';
    setTimeout(() => { box.textContent = text; }, 60);
    if (store.get(ALOUD_KEY) === '1' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const speech = new SpeechSynthesisUtterance(text);
      speech.lang = 'en-GB';
      window.speechSynthesis.speak(speech);
    }
  }

  function errText(err) {
    return S.errors[err && err.code] || S.errors.generic;
  }

  function signOutLocal() {
    store.set(TOKEN_KEY, null);
    store.set(ROLE_KEY, null);
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = {};
    const token = store.get(TOKEN_KEY);
    if (token) headers.Authorization = 'Bearer ' + token;
    let body = opts.form;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    // Fail fast on a dead connection so work drops into the offline queue instead of hanging.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.form ? 90000 : 20000);
    let res;
    try {
      res = await fetch(path, { method: opts.method || 'GET', headers, body, signal: ctrl.signal });
    } catch (cause) {
      const err = new Error('network');
      err.code = 'network';
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (opts.raw && res.ok) return res;
    let data = null;
    try {
      data = await res.json();
    } catch (cause) {
      data = null; // A non-JSON body (proxy error page) is reported below as a server error.
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'server_error');
      err.code = err.message;
      err.status = res.status;
      if (!opts.noRedirect && (res.status === 401 || err.code === 'wrong_role')) {
        signOutLocal();
        location.href = 'join.html';
      }
      throw err;
    }
    return data;
  }

  function requireRole(role) {
    const token = store.get(TOKEN_KEY);
    const mine = store.get(ROLE_KEY);
    if (!token || !HOME[mine]) {
      location.replace('join.html');
      return false;
    }
    if (mine !== role) {
      location.replace(HOME[mine]);
      return false;
    }
    return true;
  }

  function el(tag, attrs, text) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((key) => {
        const v = attrs[key];
        if (v === false || v == null) return;
        if (key === 'class') node.className = v;
        else node.setAttribute(key, v === true ? '' : String(v));
      });
    }
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function fmtTime(ms) {
    return new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function uuid() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // randomUUID is missing on older Android WebViews and on plain http.
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function resizePhoto(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 800 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.7);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  /* ----- offline queue (IndexedDB). Each item: { client_id, url, fields, photo, created_at } ----- */

  let dbPromise = null;
  function idb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('drainwatch', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('queue', { keyPath: 'client_id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }

  function tx(mode, work) {
    return idb().then((database) => new Promise((resolve, reject) => {
      const t = database.transaction('queue', mode);
      const request = work(t.objectStore('queue'));
      t.oncomplete = () => resolve(request.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  const queue = {
    add: (item) => tx('readwrite', (s) => s.put(item)),
    all: () => tx('readonly', (s) => s.getAll()).then((items) => items.sort((a, b) => a.created_at - b.created_at)),
    remove: (clientId) => tx('readwrite', (s) => s.delete(clientId))
  };

  function showQueue(state, count) {
    const box = document.getElementById('queue-state');
    if (!box) return;
    box.setAttribute('data-state', state);
    box.textContent = S.queue[state](count);
  }

  // The client_id travels with every retry, so the server stores each item once.
  function sendItem(item) {
    const form = new FormData();
    form.append('client_id', item.client_id);
    Object.keys(item.fields).forEach((key) => form.append(key, String(item.fields[key])));
    if (item.photo) form.append('photo', item.photo, 'photo.jpg');
    return api(item.url, { method: 'POST', form });
  }

  let flushing = false;
  let flushAgain = false;
  const flushListeners = [];

  async function flushQueue() {
    if (flushing) {
      flushAgain = true;
      return;
    }
    flushing = true;
    let sent = 0;
    try {
      const items = await queue.all();
      if (!items.length) {
        showQueue('synced', 0);
        return;
      }
      if (!navigator.onLine) {
        showQueue('offline', items.length);
        return;
      }
      let left = items.length;
      showQueue('syncing', left);
      for (const item of items) {
        try {
          await sendItem(item);
          sent += 1;
        } catch (err) {
          if (err.status === 401 || err.code === 'wrong_role') return;
          if (err.code === 'network' || err.status === 429 || err.status >= 500) {
            showQueue('offline', left);
            return;
          }
          say(S.queueRejected + ' ' + errText(err));
        }
        await queue.remove(item.client_id);
        left -= 1;
        showQueue(left ? 'syncing' : 'synced', left);
      }
      if (sent) say(S.queueSent);
    } catch (err) {
      console.error('Queue flush failed', err);
    } finally {
      flushing = false;
      if (sent) flushListeners.forEach((fn) => fn());
      if (flushAgain) {
        flushAgain = false;
        flushQueue();
      }
    }
  }

  function requestSync() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready
      .then((reg) => (reg.sync ? reg.sync.register('flush-queue') : null))
      .catch((err) => console.warn('Background Sync is not available; the app will send on reconnect instead', err));
  }

  // Saves to the phone first. If the phone cannot store it, tries a direct send so the work is not lost.
  async function enqueue(item) {
    try {
      await queue.add(item);
    } catch (err) {
      console.error('Could not save to the offline queue; sending directly', err);
      await sendItem(item);
      return 'sent';
    }
    requestSync();
    flushQueue();
    return 'queued';
  }

  function initPage() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker did not register', err));
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'flush-queue') flushQueue();
      });
    }
    window.addEventListener('online', flushQueue);
    window.addEventListener('offline', flushQueue);

    const aloud = document.getElementById('read-aloud');
    if (aloud) {
      if (!('speechSynthesis' in window)) {
        aloud.parentNode.hidden = true;
      } else {
        aloud.checked = store.get(ALOUD_KEY) === '1';
        aloud.addEventListener('change', () => {
          store.set(ALOUD_KEY, aloud.checked ? '1' : null);
          if (!aloud.checked) window.speechSynthesis.cancel();
        });
      }
    }

    const out = document.getElementById('logout');
    if (out) {
      out.addEventListener('click', async () => {
        signOutLocal();
        ['dw_mine', 'dw_tasks'].forEach((key) => store.set(key, null));
        if ('caches' in window) {
          try {
            const names = await caches.keys();
            await Promise.all(names.filter((n) => n.startsWith('dw-api')).map((n) => caches.delete(n)));
          } catch (err) {
            console.warn('Could not clear cached lists on sign out', err);
          }
        }
        location.href = 'join.html';
      });
    }
    flushQueue();
  }

  return {
    S, HOME, TOKEN_KEY, ROLE_KEY, store, say, errText, api, requireRole, el, clear, fmtTime, uuid, resizePhoto,
    queue, enqueue, flushQueue, initPage,
    onFlushed: (fn) => flushListeners.push(fn)
  };
})();
