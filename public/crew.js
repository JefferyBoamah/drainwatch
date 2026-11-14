'use strict';
(function () {
  if (!DW.requireRole('crew')) return;
  const S = DW.S;
  const el = DW.el;
  const $ = (id) => document.getElementById(id);
  let tasks = [];
  let queuedIds = new Set();
  let openId = null;

  DW.initPage();

  async function readQueued() {
    try {
      const items = await DW.queue.all();
      queuedIds = new Set(items.map((i) => {
        const m = i.url.match(/^\/api\/tasks\/(\d+)\/done$/);
        return m ? Number(m[1]) : null;
      }).filter((id) => id != null));
    } catch (err) {
      console.error('Could not read the offline queue', err);
      queuedIds = new Set();
    }
  }

  async function loadTasks(announce) {
    try {
      tasks = await DW.api('/api/tasks/mine');
      DW.store.set('dw_tasks', JSON.stringify(tasks));
    } catch (err) {
      // Crews often open a task with no signal at the drain: show the list saved on the phone.
      tasks = DW.store.getJson('dw_tasks', []);
      DW.say(S.tasksOffline);
      announce = false;
    }
    await readQueued();
    route(false);
    if (announce) DW.say(S.listRefreshed);
  }

  function statusKey(task) {
    if (queuedIds.has(task.id) && (task.status === 'assigned' || task.status === 'disputed')) return 'queued';
    return task.status;
  }

  // data-status only carries assigned | done | disputed; verified and queued both read as done.
  function statusAttr(key) {
    return key === 'assigned' || key === 'disputed' ? key : 'done';
  }

  function renderList() {
    const list = $('task-list');
    DW.clear(list);
    const order = { disputed: 0, assigned: 1, queued: 2, done: 3, verified: 4 };
    tasks.slice().sort((a, b) => order[statusKey(a)] - order[statusKey(b)] || b.id - a.id).forEach((t) => {
      const key = statusKey(t);
      const li = el('li', { class: 'task', 'data-status': statusAttr(key), 'data-queued': key === 'queued' ? 'true' : null });
      const title = el('p', { class: 'task-name' });
      title.appendChild(el('a', { class: 'task-link target', href: '#task/' + t.id }, t.name));
      li.appendChild(title);
      li.appendChild(el('p', { class: 'task-status' }, S.taskStatus[key]));
      list.appendChild(li);
    });
    $('tasks-empty').hidden = tasks.length > 0;
    $('tasks-empty').textContent = tasks.length ? '' : S.tasksEmpty;
  }

  function showList(moveFocus) {
    openId = null;
    $('view-task').hidden = true;
    $('view-tasks').hidden = false;
    renderList();
    if (moveFocus) $('tasks-heading').focus();
  }

  function showDetail(id, moveFocus) {
    const task = tasks.find((t) => t.id === id);
    if (!task) {
      DW.say(S.taskMissing);
      location.hash = '#tasks';
      return;
    }
    openId = id;
    const key = statusKey(task);
    $('view-tasks').hidden = true;
    $('view-task').hidden = false;
    $('view-task').setAttribute('data-status', statusAttr(key));
    $('task-title').textContent = task.name;
    $('task-status').textContent = S.taskStatus[key];
    $('task-condition').textContent = task.condition ? S.taskCondition(S.conditions[task.condition]) : '';
    $('task-note').textContent = task.note ? S.taskNote(task.note) : '';
    $('task-note').hidden = !task.note;
    $('task-navigate').href = 'https://www.google.com/maps/dir/?api=1&destination=' + task.lat + ',' + task.lng;
    $('done-form').hidden = !(key === 'assigned' || key === 'disputed');
    $('done-form').reset();
    if (moveFocus) $('task-title').focus();
  }

  function route(moveFocus) {
    const m = location.hash.match(/^#task\/(\d+)$/);
    if (m) showDetail(Number(m[1]), moveFocus);
    else if (location.hash !== '#main') showList(moveFocus);
  }
  window.addEventListener('hashchange', () => route(true));

  $('refresh-tasks').addEventListener('click', () => loadTasks(true));

  $('done-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (openId == null) return;
    const file = $('after-photo').files[0];
    if (!file) {
      DW.say(S.needAfterPhoto);
      $('after-photo').focus();
      return;
    }
    $('done-submit').disabled = true;
    try {
      const photo = await DW.resizePhoto(file);
      if (!photo) {
        DW.say(S.photoUnreadableRetry);
        $('after-photo').focus();
        return;
      }
      const item = { client_id: DW.uuid(), url: '/api/tasks/' + openId + '/done', fields: {}, photo, created_at: Date.now() };
      const result = await DW.enqueue(item);
      if (result === 'sent') {
        await loadTasks(false);
      } else {
        queuedIds.add(openId);
      }
      DW.say(navigator.onLine ? S.doneSending : S.doneSavedOffline);
      location.hash = '#tasks';
    } catch (err) {
      DW.say(err.code ? DW.errText(err) : S.errors.queue_storage);
    } finally {
      $('done-submit').disabled = false;
    }
  });

  DW.onFlushed(() => loadTasks(false));

  loadTasks(false);
})();
