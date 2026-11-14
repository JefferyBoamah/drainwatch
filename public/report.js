'use strict';
(function () {
  if (!DW.requireRole('reporter')) return;
  const S = DW.S;
  const el = DW.el;
  const $ = (id) => document.getElementById(id);
  const VIEWS = ['report', 'mine', 'alerts'];
  let current = 'report';
  let gps = null;
  let landmarks = [];
  let pendingConfirms = [];

  DW.initPage();

  /* ----- views ----- */

  function showView(moveFocus) {
    const wanted = location.hash.replace('#', '');
    if (wanted === 'main') return; // The skip link targets #main and must not switch views.
    current = VIEWS.includes(wanted) ? wanted : 'report';
    VIEWS.forEach((name) => {
      $('view-' + name).hidden = name !== current;
      if (name === current) $('nav-' + name).setAttribute('aria-current', 'page');
      else $('nav-' + name).removeAttribute('aria-current');
    });
    if (moveFocus) $(current + '-heading').focus();
    if (current === 'mine') loadMine();
    if (current === 'alerts') loadAlerts();
  }
  window.addEventListener('hashchange', () => showView(true));

  /* ----- landmarks ----- */

  function fillSelect(select, firstLabel) {
    const keep = select.value;
    DW.clear(select);
    select.appendChild(el('option', { value: '' }, firstLabel));
    landmarks.forEach((l) => select.appendChild(el('option', { value: l.id }, l.name)));
    select.value = keep;
  }

  async function loadLandmarks() {
    try {
      landmarks = await DW.api('/api/landmarks');
      DW.store.set('dw_landmarks', JSON.stringify(landmarks));
    } catch (err) {
      // First load on a dead connection: fall back to the copy saved on the phone.
      landmarks = DW.store.getJson('dw_landmarks', []);
      if (!landmarks.length) DW.say(S.landmarksFailed);
    }
    fillSelect($('landmark'), S.chooseLandmark);
    fillSelect($('rain-landmark'), S.noRainAlerts);
    try {
      const me = await DW.api('/api/me');
      $('rain-landmark').value = me.rain_landmark_id == null ? '' : String(me.rain_landmark_id);
    } catch (err) {
      console.warn('Could not load the saved rain alert place', err);
    }
  }

  /* ----- location ----- */

  function gpsFailed(message) {
    gps = null;
    $('gps-result').textContent = message;
    DW.say(message);
    $('landmark').focus();
  }

  $('use-gps').addEventListener('click', () => {
    if (!navigator.geolocation) {
      gpsFailed(S.gpsUnsupported);
      return;
    }
    $('use-gps').disabled = true;
    DW.say(S.gpsFinding);
    navigator.geolocation.getCurrentPosition((pos) => {
      $('use-gps').disabled = false;
      gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const metres = Math.round(pos.coords.accuracy);
      $('landmark').value = '';
      const message = metres > 100 ? S.gpsWeak(metres) : S.gpsGood(metres);
      $('gps-result').textContent = message;
      DW.say(message);
      if (metres > 100) $('landmark').focus();
    }, (err) => {
      $('use-gps').disabled = false;
      gpsFailed(err.code === 1 ? S.gpsDenied : S.gpsTimeout);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });

  $('landmark').addEventListener('change', () => {
    if ($('landmark').value) {
      gps = null;
      $('gps-result').textContent = S.usingLandmark;
    }
  });

  /* ----- speech to text ----- */

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speakButton = $('speak-note');
  if (!Recognition) {
    speakButton.hidden = true;
  } else {
    let listening = null;
    speakButton.addEventListener('click', () => {
      if (listening) {
        listening.stop();
        return;
      }
      const rec = new Recognition();
      rec.lang = 'en-GH'; // If a device does not support en-GH, change this to 'en-GB'.
      rec.interimResults = false;
      rec.onresult = (event) => {
        const text = event.results[0][0].transcript;
        const note = $('note');
        note.value = (note.value ? note.value + ' ' : '') + text;
        DW.say(S.speechHeard(text));
      };
      rec.onerror = (event) => {
        DW.say(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? S.micDenied : S.speechFailed);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') $('note').focus();
      };
      rec.onend = () => {
        listening = null;
        speakButton.textContent = S.speakStart;
        speakButton.removeAttribute('data-listening');
      };
      listening = rec;
      // No spoken "listening" message here: the microphone would pick it up and type it into the note.
      // The button text changes instead, so the state is never audio-only.
      speakButton.textContent = S.speakStop;
      speakButton.setAttribute('data-listening', 'true');
      rec.start();
    });
  }

  /* ----- send report ----- */

  $('report-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const chosen = document.querySelector('input[name="condition"]:checked');
    if (!chosen) {
      DW.say(S.needCondition);
      $('cond-clear').focus();
      return;
    }
    const landmarkId = $('landmark').value;
    if (!gps && !landmarkId) {
      DW.say(S.needLocation);
      $('use-gps').focus();
      return;
    }
    $('send-report').disabled = true;
    try {
      const fields = { condition: chosen.value, note: $('note').value.trim().slice(0, 500) };
      if (gps) {
        fields.lat = gps.lat;
        fields.lng = gps.lng;
      } else {
        fields.landmark_id = landmarkId;
      }
      let photo = null;
      let photoProblem = '';
      const file = $('photo').files[0];
      if (file) {
        photo = await DW.resizePhoto(file);
        if (!photo) photoProblem = ' ' + S.photoUnreadable;
      }
      const item = { client_id: DW.uuid(), url: '/api/reports', fields, photo, created_at: Date.now() };
      const result = await DW.enqueue(item);
      $('report-form').reset();
      gps = null;
      $('gps-result').textContent = '';
      const message = result === 'sent' ? S.reportSent : navigator.onLine ? S.reportSending : S.reportSavedOffline;
      DW.say(message + photoProblem);
      $('report-heading').focus();
    } catch (err) {
      DW.say(err.code ? DW.errText(err) : S.errors.queue_storage);
    } finally {
      $('send-report').disabled = false;
    }
  });

  /* ----- my reports ----- */

  async function loadMine() {
    let rows;
    try {
      rows = await DW.api('/api/reports/mine');
      DW.store.set('dw_mine', JSON.stringify(rows));
    } catch (err) {
      rows = DW.store.getJson('dw_mine', []);
      DW.say(S.mineOffline);
    }
    let waiting = [];
    try {
      waiting = (await DW.queue.all()).filter((i) => i.url === '/api/reports');
    } catch (err) {
      console.error('Could not read the offline queue', err);
    }
    const list = $('mine-list');
    DW.clear(list);
    waiting.forEach((i) => list.appendChild(reportItem(S.waitingPlace, i.fields.condition, i.created_at, 'waiting')));
    rows.forEach((r) => list.appendChild(reportItem(r.name, r.condition, r.created_at, r.status)));
    const empty = !waiting.length && !rows.length;
    $('mine-empty').hidden = !empty;
    $('mine-empty').textContent = empty ? S.mineEmpty : '';
  }

  function reportItem(place, condition, time, status) {
    const li = el('li', { class: 'report', 'data-report-status': status });
    li.appendChild(el('p', { class: 'report-place' }, place));
    li.appendChild(el('p', { class: 'report-condition' }, S.reportLine(S.conditions[condition] || condition, DW.fmtTime(time))));
    li.appendChild(el('p', { class: 'report-status' }, S.reportStatus[status] || status));
    return li;
  }

  /* ----- messages ----- */

  async function loadAlerts() {
    let data;
    try {
      data = await DW.api('/api/notifications');
    } catch (err) {
      DW.say(S.alertsFailed);
      return;
    }
    const list = $('alerts-list');
    DW.clear(list);
    data.items.forEach((n) => {
      const li = el('li', { class: 'alert', 'data-kind': n.kind, 'data-read': n.read ? 'true' : 'false' });
      li.appendChild(el('p', { class: 'alert-kind' }, (S.alertKinds[n.kind] || n.kind) + (n.read ? '' : ' (new)')));
      li.appendChild(el('p', { class: 'alert-text' }, n.text));
      li.appendChild(el('p', { class: 'alert-time' }, DW.fmtTime(n.created_at)));
      list.appendChild(li);
    });
    $('alerts-empty').hidden = data.items.length > 0;
    $('alerts-empty').textContent = data.items.length ? '' : S.alertsEmpty;
    if (data.unread > 0) {
      DW.api('/api/notifications/read', { method: 'POST', body: {} })
        .catch((err) => console.warn('Could not mark messages as read', err));
    }
  }

  $('rain-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = $('rain-landmark').value;
    try {
      await DW.api('/api/me/rain-alerts', { method: 'PUT', body: { landmark_id: value ? Number(value) : null } });
      DW.say(value ? S.rainSaved : S.rainOff);
    } catch (err) {
      DW.say(DW.errText(err));
    }
  });

  /* ----- confirm clearance ----- */

  function showConfirm() {
    const box = $('confirm-box');
    if (!pendingConfirms.length) {
      box.hidden = true;
      return;
    }
    const text = S.confirmAsk(pendingConfirms[0].name);
    const isNew = box.hidden || $('confirm-text').textContent !== text;
    $('confirm-text').textContent = text;
    box.hidden = false;
    if (isNew) DW.say(text);
  }

  async function loadConfirms() {
    try {
      pendingConfirms = await DW.api('/api/confirmations/pending');
      showConfirm();
    } catch (err) {
      // A background check; the next poll will try again, so the user is not interrupted.
      console.warn('Could not check for drains to confirm', err);
    }
  }

  async function answerConfirm(stillBlocked) {
    const task = pendingConfirms[0];
    if (!task) return;
    $('confirm-yes').disabled = true;
    $('confirm-no').disabled = true;
    try {
      await DW.api('/api/confirmations', { method: 'POST', body: { task_id: task.task_id, still_blocked: stillBlocked } });
      pendingConfirms.shift();
      $('confirm-box').hidden = true;
      DW.say(stillBlocked ? S.confirmThanksNo : S.confirmThanksYes);
      if (pendingConfirms.length) setTimeout(showConfirm, 4000);
      if (current === 'mine') loadMine();
    } catch (err) {
      DW.say(DW.errText(err));
      if (err.code === 'confirm_closed') {
        pendingConfirms.shift();
        showConfirm();
      }
    } finally {
      $('confirm-yes').disabled = false;
      $('confirm-no').disabled = false;
    }
  }
  $('confirm-yes').addEventListener('click', () => answerConfirm(false));
  $('confirm-no').addEventListener('click', () => answerConfirm(true));

  /* ----- polling: every 60 s while the page is visible ----- */

  function poll() {
    if (document.visibilityState !== 'visible') return;
    loadConfirms();
    if (current === 'alerts') loadAlerts();
  }
  setInterval(poll, 60000);
  document.addEventListener('visibilitychange', poll);

  DW.onFlushed(() => {
    if (current === 'mine') loadMine();
  });

  showView(false);
  loadLandmarks();
  loadConfirms();
})();
