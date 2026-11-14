'use strict';
(function () {
  if (!DW.requireRole('admin')) return;
  const S = DW.S;
  const el = DW.el;
  const $ = (id) => document.getElementById(id);
  let data = null;
  let crew = [];
  let map = null;
  let markerLayer = null;
  let focusDrainId = null;

  DW.initPage();

  async function act(work, okText) {
    try {
      await work();
      if (okText) DW.say(okText);
      return true;
    } catch (err) {
      DW.say(DW.errText(err));
      return false;
    }
  }

  /* ----- ranking ----- */

  async function loadRanking() {
    data = await DW.api('/api/ranking');
    renderRain();
    renderRanking();
    renderBlind();
    renderMap();
  }

  function renderRain() {
    const rain = data.rain;
    const box = $('rain-summary');
    box.setAttribute('data-stale', rain.stale ? 'true' : 'false');
    const parts = [];
    if (rain.sum_mm == null) {
      parts.push(S.rainMissing);
    } else {
      if (rain.stale) parts.push(S.rainStale(rain.fetched_at ? DW.fmtTime(rain.fetched_at) : '—'));
      parts.push(S.rainFresh(rain.sum_mm));
      parts.push(rain.peak_at == null ? S.rainNoPeak : S.rainPeak(DW.fmtTime(rain.peak_at), Math.round(rain.hours_to_peak)));
    }
    box.textContent = parts.join(' ');
    if (document.activeElement !== $('capacity')) $('capacity').value = data.capacity;
  }

  function cutLine() {
    return el('li', { class: 'cut-line' }, S.cutLine(data.reach));
  }

  function renderRanking() {
    const list = $('ranking');
    DW.clear(list);
    $('ranking-empty').hidden = data.drains.length > 0;
    $('ranking-empty').textContent = data.drains.length ? '' : S.rankingEmpty;
    data.drains.forEach((d, i) => {
      if (i === data.cut_index + 1) list.appendChild(cutLine());
      list.appendChild(drainItem(d));
    });
    if (data.drains.length && data.cut_index >= data.drains.length - 1) list.appendChild(cutLine());
    if (focusDrainId != null) {
      const title = list.querySelector('[data-drain-id="' + focusDrainId + '"] .drain-title');
      if (title) title.focus();
      focusDrainId = null;
    }
  }

  function taskAttr(d) {
    if (!d.task) return null;
    if (d.task.status === 'assigned' || d.task.status === 'disputed') return d.task.status;
    return d.cleared ? 'done' : null;
  }

  function taskText(d) {
    if (!d.task) return S.taskNone;
    if (d.task.status === 'assigned') return S.taskAssigned(d.task.crew_phone);
    if (d.task.status === 'disputed') return S.taskDisputed(d.task.crew_phone);
    if (!d.cleared) return S.taskNone; // A new report arrived after the last clearance.
    return d.task.status === 'verified' ? S.taskVerified(d.task.crew_phone) : S.taskDoneWaiting(d.task.crew_phone);
  }

  function drainItem(d) {
    const li = el('li', {
      class: 'drain', 'data-drain-id': d.id, 'data-priority': d.band, 'data-status': taskAttr(d),
      'data-overridden': d.override ? 'true' : null, 'data-disputed': d.disputed ? 'true' : null
    });
    li.appendChild(el('h3', { class: 'drain-title', tabindex: '-1' }, d.position + '. ' + d.name));
    li.appendChild(el('p', { class: 'drain-priority' }, S.priorityLine(S.bands[d.band], d.score)));
    if (d.disputed) li.appendChild(el('p', { class: 'drain-flag drain-flag-disputed' }, S.disputedFlag));
    if (d.override) li.appendChild(el('p', { class: 'drain-flag drain-flag-override' }, S.overrideFlag(d.override.rank, d.override.reason)));
    li.appendChild(el('p', { class: 'drain-why' }, d.explanation));
    if (d.reporters >= 2) li.appendChild(el('p', { class: 'drain-corroboration' }, S.peopleReported(d.reporters)));

    const task = el('p', { class: 'drain-task' }, taskText(d) + ' ');
    if (d.task && d.task.after_photo) {
      const href = '/api/uploads/' + encodeURIComponent(d.task.after_photo) + '?token=' + encodeURIComponent(DW.store.get(DW.TOKEN_KEY) || '');
      task.appendChild(el('a', { class: 'drain-photo-link', href, target: '_blank', rel: 'noopener' }, S.viewAfterPhoto));
    }
    li.appendChild(task);

    li.appendChild(assignForm(d));

    // The edit forms are built only when opened, to keep a long list light on slow devices.
    const details = el('details', { class: 'drain-edit' });
    details.appendChild(el('summary', { class: 'target' }, S.editSummary));
    details.addEventListener('toggle', () => {
      if (details.open && details.children.length === 1) {
        details.appendChild(overrideForm(d));
        details.appendChild(scoresForm(d));
      }
    });
    li.appendChild(details);
    return li;
  }

  function field(labelText, input) {
    const p = el('p', { class: 'field' });
    p.appendChild(el('label', { for: input.id }, labelText));
    p.appendChild(input);
    return p;
  }

  function assignForm(d) {
    const form = el('form', { class: 'form form-inline assign-form', novalidate: true });
    const select = el('select', { id: 'crew-for-' + d.id, class: 'target' });
    select.appendChild(el('option', { value: '' }, S.chooseCrew));
    crew.forEach((c) => select.appendChild(el('option', { value: c.id }, c.phone)));
    if (d.task && (d.task.status === 'assigned' || d.task.status === 'disputed')) select.value = String(d.task.crew_id);
    form.appendChild(field(S.assignLabel(d.name), select));
    form.appendChild(el('button', { type: 'submit', class: 'target' }, S.assignButton));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!select.value) {
        DW.say(S.needCrew);
        select.focus();
        return;
      }
      const ok = await act(() => DW.api('/api/tasks', { method: 'POST', body: { drain_id: d.id, crew_id: Number(select.value) } }), S.assigned);
      if (ok) reloadKeepingFocus(d.id);
    });
    return form;
  }

  function overrideForm(d) {
    const form = el('form', { class: 'form override-form', novalidate: true });
    const rank = el('input', { type: 'number', id: 'rank-' + d.id, class: 'target', min: '1', step: '1', inputmode: 'numeric', required: true });
    const reason = el('input', { type: 'text', id: 'reason-' + d.id, class: 'target', maxlength: '300', required: true });
    if (d.override) {
      rank.value = d.override.rank;
      reason.value = d.override.reason;
    }
    form.appendChild(field(S.rankLabel, rank));
    form.appendChild(field(S.reasonLabel, reason));
    form.appendChild(el('button', { type: 'submit', class: 'target' }, S.saveRank));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = Number(rank.value);
      if (!Number.isInteger(value) || value < 1) {
        DW.say(S.errors.bad_rank);
        rank.focus();
        return;
      }
      if (reason.value.trim().length < 3) {
        DW.say(S.errors.reason_required);
        reason.focus();
        return;
      }
      const ok = await act(() => DW.api('/api/drains/' + d.id + '/override', { method: 'POST', body: { rank: value, reason: reason.value.trim() } }), S.rankSaved);
      if (ok) reloadKeepingFocus(d.id);
    });
    if (d.override) {
      const remove = el('button', { type: 'button', class: 'target override-remove' }, S.removeRank);
      remove.addEventListener('click', async () => {
        const ok = await act(() => DW.api('/api/drains/' + d.id + '/override', { method: 'DELETE' }), S.rankRemoved);
        if (ok) reloadKeepingFocus(d.id);
      });
      form.appendChild(remove);
    }
    return form;
  }

  function scoresForm(d) {
    const form = el('form', { class: 'form scores-form', novalidate: true });
    const flood = el('input', { type: 'number', id: 'flood-' + d.id, class: 'target', min: '0', max: '1', step: '0.05', inputmode: 'decimal', required: true });
    const exposure = el('input', { type: 'number', id: 'exposure-' + d.id, class: 'target', min: '0', max: '1', step: '0.05', inputmode: 'decimal', required: true });
    flood.value = d.flood_risk;
    exposure.value = d.exposure;
    form.appendChild(field(S.floodLabel, flood));
    form.appendChild(field(S.exposureLabel, exposure));
    form.appendChild(el('button', { type: 'submit', class: 'target' }, S.saveScores));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Number(flood.value);
      const x = Number(exposure.value);
      const valid = (n, raw) => raw !== '' && Number.isFinite(n) && n >= 0 && n <= 1;
      if (!valid(f, flood.value) || !valid(x, exposure.value)) {
        DW.say(S.errors.bad_scores);
        (valid(f, flood.value) ? exposure : flood).focus();
        return;
      }
      const ok = await act(() => DW.api('/api/drains/' + d.id, { method: 'PUT', body: { flood_risk: f, exposure: x } }), S.scoresSaved);
      if (ok) reloadKeepingFocus(d.id);
    });
    return form;
  }

  async function reloadKeepingFocus(drainId) {
    focusDrainId = drainId;
    await act(loadRanking);
    act(loadStats);
  }

  /* ----- map (secondary; the list above carries the same information) ----- */

  function renderMap() {
    if (!data) return;
    if (!window.L) {
      $('map-note').textContent = S.mapUnavailable;
      return;
    }
    $('map-note').textContent = '';
    if (!map) {
      map = L.map('map').setView([5.60, -0.19], 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
      markerLayer = L.layerGroup().addTo(map);
    }
    markerLayer.clearLayers();
    data.drains.forEach((d) => {
      const icon = L.divIcon({
        className: 'drain-marker drain-marker-' + d.band + (d.disputed ? ' drain-marker-disputed' : '') + (d.cleared ? ' drain-marker-done' : ''),
        html: String(d.position),
        iconSize: null
      });
      const popup = el('div', { class: 'drain-popup' });
      popup.appendChild(el('strong', null, d.position + '. ' + d.name));
      popup.appendChild(el('p', null, S.priorityLine(S.bands[d.band], d.score)));
      popup.appendChild(el('p', null, d.explanation));
      L.marker([d.lat, d.lng], { icon, title: d.position + '. ' + d.name, alt: d.position + '. ' + d.name }).bindPopup(popup).addTo(markerLayer);
    });
  }

  // Leaflet loads async so a slow CDN never delays the ranked list.
  const leafletScript = $('leaflet-js');
  if (!window.L && leafletScript) {
    leafletScript.addEventListener('load', renderMap);
    leafletScript.addEventListener('error', () => { $('map-note').textContent = S.mapUnavailable; });
  }

  /* ----- blind spots ----- */

  function renderBlind() {
    const list = $('blind-list');
    DW.clear(list);
    data.blind_spots.forEach((b) => {
      list.appendChild(el('li', { class: 'blind-spot', 'data-drain-id': b.id },
        S.blindLine(b.name, b.flood_risk, b.last_report_at ? DW.fmtTime(b.last_report_at) : null)));
    });
    $('blind-empty').hidden = data.blind_spots.length > 0;
    $('blind-empty').textContent = data.blind_spots.length ? '' : S.blindEmpty;
  }

  /* ----- review queue ----- */

  async function loadReview() {
    const rows = await DW.api('/api/review');
    const list = $('review-list');
    DW.clear(list);
    rows.forEach((r) => {
      const li = el('li', { class: 'review-item' });
      li.appendChild(el('p', { class: 'review-text' }, S.reviewLine(r.name, S.conditions[r.condition], DW.fmtTime(r.created_at))));
      if (r.note) li.appendChild(el('p', { class: 'review-note' }, S.reviewNote(r.note)));
      const form = el('form', { class: 'form form-inline review-form', novalidate: true });
      const select = el('select', { id: 'review-' + r.id, class: 'target' });
      Object.keys(S.conditions).forEach((key) => select.appendChild(el('option', { value: key }, S.conditions[key])));
      select.value = r.condition;
      form.appendChild(field(S.reviewLabel(r.name), select));
      form.appendChild(el('button', { type: 'submit', class: 'target' }, S.reviewButton));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ok = await act(() => DW.api('/api/reports/' + r.id + '/review', { method: 'POST', body: { condition: select.value } }), S.reviewSaved);
        if (ok) {
          await act(loadReview);
          await act(loadRanking);
          $('review-heading').setAttribute('tabindex', '-1');
          $('review-heading').focus();
        }
      });
      li.appendChild(form);
      list.appendChild(li);
    });
    $('review-empty').hidden = rows.length > 0;
    $('review-empty').textContent = rows.length ? '' : S.reviewEmpty;
  }

  /* ----- stats and export ----- */

  async function loadStats() {
    const s = await DW.api('/api/stats');
    $('stat-reports').textContent = String(s.reports_received);
    $('stat-cleared').textContent = String(s.drains_cleared);
    $('stat-avg').textContent = s.avg_hours_to_clear == null ? S.avgNone : S.avgHours(s.avg_hours_to_clear);
    $('stat-blocked').textContent = String(s.blocked_before_peak);
  }

  $('export-csv').addEventListener('click', () => act(async () => {
    const res = await DW.api('/api/export.csv', { raw: true });
    const url = URL.createObjectURL(await res.blob());
    const link = el('a', { href: url, download: 'drainwatch-ranking.csv', hidden: true });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, S.exportReady));

  /* ----- capacity, refresh ----- */

  $('capacity-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = Number($('capacity').value);
    if (!Number.isInteger(value) || value < 1 || value > 500) {
      DW.say(S.errors.bad_capacity);
      $('capacity').focus();
      return;
    }
    const ok = await act(() => DW.api('/api/settings', { method: 'PUT', body: { capacity: value } }), S.capacitySaved);
    if (ok) act(loadRanking);
  });

  $('refresh').addEventListener('click', () => refreshAll(S.listRefreshed));

  /* ----- crew ----- */

  async function loadCrew() {
    crew = await DW.api('/api/crew');
    const list = $('crew-list');
    DW.clear(list);
    crew.forEach((c) => list.appendChild(el('li', { class: 'crew-member' }, c.phone)));
    $('crew-empty').hidden = crew.length > 0;
    $('crew-empty').textContent = crew.length ? '' : S.crewEmpty;
  }

  $('crew-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = $('crew-phone').value.trim();
    if (!phone) {
      DW.say(S.errors.bad_phone);
      $('crew-phone').focus();
      return;
    }
    const ok = await act(() => DW.api('/api/crew', { method: 'POST', body: { phone } }), S.crewInvited);
    if (ok) {
      $('crew-form').reset();
      await act(loadCrew);
      if (data) renderRanking();
    }
  });

  /* ----- landmarks ----- */

  function resetLandmarkForm() {
    $('landmark-form').reset();
    $('lm-id').value = '';
    $('lm-active-row').hidden = true;
    $('lm-cancel').hidden = true;
    $('lm-save').textContent = S.addLandmark;
  }

  async function loadLandmarks() {
    const rows = await DW.api('/api/landmarks?all=1');
    const list = $('landmark-list');
    DW.clear(list);
    rows.forEach((l) => {
      const li = el('li', { class: 'landmark', 'data-active': l.active ? 'true' : 'false' });
      li.appendChild(el('p', { class: 'landmark-text' }, S.landmarkLine(l)));
      const edit = el('button', { type: 'button', class: 'target landmark-edit' }, S.landmarkEdit(l.name));
      edit.addEventListener('click', () => {
        $('lm-id').value = l.id;
        $('lm-name').value = l.name;
        $('lm-lat').value = l.lat;
        $('lm-lng').value = l.lng;
        $('lm-active').checked = !!l.active;
        $('lm-active-row').hidden = false;
        $('lm-cancel').hidden = false;
        $('lm-save').textContent = S.saveLandmark;
        DW.say(S.landmarkEditing(l.name));
        $('lm-name').focus();
      });
      li.appendChild(edit);
      list.appendChild(li);
    });
  }

  $('lm-cancel').addEventListener('click', resetLandmarkForm);

  $('landmark-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('lm-id').value;
    const body = { name: $('lm-name').value.trim(), lat: Number($('lm-lat').value), lng: Number($('lm-lng').value) };
    if (body.name.length < 2 || $('lm-lat').value === '' || $('lm-lng').value === '') {
      DW.say(S.errors.bad_landmark);
      $('lm-name').focus();
      return;
    }
    if (id) body.active = $('lm-active').checked;
    const ok = await act(() => DW.api(id ? '/api/landmarks/' + id : '/api/landmarks', { method: id ? 'PUT' : 'POST', body }), S.landmarkSaved);
    if (ok) {
      resetLandmarkForm();
      await act(loadLandmarks);
      act(loadRanking);
    }
  });

  /* ----- start ----- */

  async function refreshAll(okText) {
    // Crew first: the ranked list needs the crew names for its assign menus.
    const results = [];
    results.push(await act(loadCrew));
    results.push(await act(loadRanking));
    results.push(await act(loadReview));
    results.push(await act(loadStats));
    results.push(await act(loadLandmarks));
    if (okText && results.every(Boolean)) DW.say(okText);
  }

  refreshAll(null);
})();
