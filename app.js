const ZONES = [
  { id: 'Asia/Shanghai', name: '北京 / 上海', short: '北京时间' },
  { id: 'America/Toronto', name: '加拿大东部 · Toronto', short: '加东时间' },
  { id: 'America/New_York', name: '美国东部 · New York', short: '美东时间' },
  { id: 'America/Chicago', name: '美国中部 · Chicago', short: '芝加哥时间' },
  { id: 'America/Vancouver', name: '加拿大西部 · Vancouver', short: '加西时间' },
  { id: 'America/Los_Angeles', name: '美国西部 · Los Angeles', short: '美西时间' },
  { id: 'Australia/Sydney', name: '澳洲东部 · Sydney', short: '悉尼时间' },
  { id: 'Europe/London', name: '英国 · London', short: '英国时间' }
];

const STORAGE_KEY = 'lesson-availability-v1';
const BACKUP_APP_ID = 'lesson-availability';
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const MAX_SESSIONS = 10000;
const SLOT_MINUTES = 30;
const state = loadState();
let drag = null;
let toastTimer;

const $ = (id) => document.getElementById(id);
const zoneSelect = $('timezoneSelect');
const calendarGrid = $('calendarGrid');
const createId = () => globalThis.crypto?.randomUUID?.() || `slot-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function loadState() {
  const fallback = { zone: 'Asia/Shanghai', restStart: '00:00', restEnd: '08:00', sessions: [], weekStart: '', rangeMode: 'today' };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const loaded = { ...fallback, ...saved, weekStart: saved.rangeMode ? saved.weekStart : '' };
    loaded.sessions = Array.isArray(loaded.sessions)
      ? loaded.sessions.map(s => ({ ...s, type: s.type === 'personal' ? 'personal' : 'lesson' }))
      : [];
    return loaded;
  }
  catch { return fallback; }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function exportBackup() {
  normalizeSessions();
  const payload = {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      zone: state.zone,
      restStart: state.restStart,
      restEnd: state.restEnd,
      sessions: state.sessions,
      weekStart: state.weekStart,
      rangeMode: state.rangeMode
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `课时空档备份-${localDateNow('Asia/Shanghai')}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setBackupStatus(`已导出 ${state.sessions.length} 个占用时段`);
  showToast('备份文件已导出');
}

function validateBackup(payload) {
  if (!payload || payload.app !== BACKUP_APP_ID || payload.version !== BACKUP_VERSION || !payload.data) {
    throw new Error('这不是有效的课时空档备份文件。');
  }
  const data = payload.data;
  if (!ZONES.some(z => z.id === data.zone)) throw new Error('备份中的时区无法识别。');
  if (!isValidTime(data.restStart) || !isValidTime(data.restEnd)) throw new Error('备份中的休息时间无效。');
  if (!Array.isArray(data.sessions)) throw new Error('备份中的占用记录格式无效。');
  if (data.sessions.length > MAX_SESSIONS) throw new Error('备份中的占用记录过多，无法安全导入。');
  const sessions = data.sessions.map((session, index) => {
    if (!Number.isSafeInteger(session?.start) || !Number.isSafeInteger(session?.end) || session.end <= session.start) {
      throw new Error(`第 ${index + 1} 条占用记录无效。`);
    }
    const minDate = Date.UTC(2000, 0, 1);
    const maxDate = Date.UTC(2100, 0, 1);
    if (session.start < minDate || session.end > maxDate || session.end - session.start > 24 * 60 * 60 * 1000) {
      throw new Error(`第 ${index + 1} 条占用记录的日期或时长超出支持范围。`);
    }
    return {
      id: typeof session.id === 'string' && session.id ? session.id : createId(),
      start: session.start,
      end: session.end,
      type: session.type === 'personal' ? 'personal' : 'lesson',
      note: typeof session.note === 'string' ? session.note.slice(0, 30) : ''
    };
  });
  const rangeMode = data.rangeMode === 'monday' ? 'monday' : 'today';
  const validWeekStart = typeof data.weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.weekStart);
  const today = localDateNow(data.zone);
  const ordered = [...sessions].sort((a, b) => a.start - b.start);
  if (ordered.some((session, index) => index > 0 && session.start < ordered[index - 1].end)) {
    throw new Error('备份中存在相互重叠的占用记录。');
  }
  return {
    zone: data.zone,
    restStart: data.restStart,
    restEnd: data.restEnd,
    sessions,
    rangeMode,
    weekStart: validWeekStart ? data.weekStart : (rangeMode === 'monday' ? mondayOf(today) : today)
  };
}

async function importBackup(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件过大，最大支持 2 MB。');
    const payload = JSON.parse(await file.text());
    const restored = validateBackup(payload);
    if (!confirm(`导入将覆盖当前数据，并恢复 ${restored.sessions.length} 个占用时段。是否继续？`)) return;
    Object.assign(state, restored);
    normalizeSessions();
    saveState();
    syncControlsFromState();
    render();
    requestAnimationFrame(scrollToUsefulHours);
    setBackupStatus(`恢复成功：${state.sessions.length} 个占用时段`);
    showToast('备份已恢复');
  } catch (error) {
    setBackupStatus(error instanceof Error ? error.message : '导入失败，请检查备份文件。', true);
  } finally {
    input.value = '';
  }
}

function isValidTime(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60;
}

function setBackupStatus(message, isError = false) {
  const status = $('backupStatus');
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(p) { return `${p.year}-${pad(p.month)}-${pad(p.day)}`; }
function parseDateKey(value) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}
function addDays(value, days) {
  const p = typeof value === 'string' ? parseDateKey(value) : value;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function mondayOf(value) {
  const p = parseDateKey(value);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return addDays(value, -(day === 0 ? 6 : day - 1));
}
function preferredStart() {
  const today = localDateNow(state.zone);
  return state.rangeMode === 'monday' ? mondayOf(today) : today;
}
function partsInZone(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(ms));
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
function localDateNow(timeZone) { return dateKey(partsInZone(Date.now(), timeZone)); }
function zoneOffsetMs(ms, timeZone) {
  const p = partsInZone(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60000) * 60000;
}
function zonedToUtc(date, time, timeZone) {
  const p = parseDateKey(date);
  const [hour, minute] = time.split(':').map(Number);
  let guess = Date.UTC(p.year, p.month - 1, p.day, hour, minute);
  for (let i = 0; i < 3; i++) guess = Date.UTC(p.year, p.month - 1, p.day, hour, minute) - zoneOffsetMs(guess, timeZone);
  return guess;
}
function beijingToUtc(date, time) {
  const p = parseDateKey(date);
  const [hour, minute] = time.split(':').map(Number);
  return Date.UTC(p.year, p.month - 1, p.day, hour - 8, minute);
}
function timeToMinutes(value) {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}
function formatTime(ms, timeZone) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
}
function formatDate(ms, timeZone, withYear = false) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone, ...(withYear && { year: 'numeric' }), month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(ms));
}
function zoneOffsetLabel(timeZone, ms = Date.now()) {
  const minutes = Math.round(zoneOffsetMs(ms, timeZone) / 60000);
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${pad(abs % 60)}` : ''}`;
}
function isRest(ms) {
  const p = partsInZone(ms, 'Asia/Shanghai');
  const current = p.hour * 60 + p.minute;
  const start = timeToMinutes(state.restStart);
  const end = timeToMinutes(state.restEnd);
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}
function sessionAt(ms) { return state.sessions.find(s => ms >= s.start && ms < s.end); }
function isBusy(ms) { return Boolean(sessionAt(ms)); }
function selectedSessionType() {
  return document.querySelector('input[name="sessionType"]:checked')?.value === 'personal' ? 'personal' : 'lesson';
}
function typeLabel(type) { return type === 'personal' ? '个人事务' : '已排课'; }

function normalizeSessions() {
  const items = state.sessions
    .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const item of items) {
    const last = merged.at(-1);
    item.type = item.type === 'personal' ? 'personal' : 'lesson';
    if (last && item.start <= last.end && item.type === last.type && item.note === last.note) {
      last.end = Math.max(last.end, item.end);
    } else merged.push({ ...item, id: item.id || createId() });
  }
  state.sessions = merged;
}

function setSlotBusy(start, makeBusy, type = selectedSessionType()) {
  const end = start + SLOT_MINUTES * 60000;
  if (makeBusy) {
    if (!isBusy(start)) state.sessions.push({ id: createId(), start, end, type, note: typeLabel(type) });
  } else {
    const next = [];
    for (const s of state.sessions) {
      if (end <= s.start || start >= s.end) next.push(s);
      else {
        if (s.start < start) next.push({ ...s, id: createId(), end: start });
        if (s.end > end) next.push({ ...s, id: createId(), start: end });
      }
    }
    state.sessions = next;
  }
  normalizeSessions();
  saveState();
}

function init() {
  ZONES.forEach(z => zoneSelect.add(new Option(z.name, z.id)));
  zoneSelect.value = ZONES.some(z => z.id === state.zone) ? state.zone : 'Asia/Shanghai';
  state.zone = zoneSelect.value;
  if (!state.weekStart || state.rangeMode === 'today') state.weekStart = preferredStart();
  syncControlsFromState();
  $('sessionDate').value = localDateNow('Asia/Shanghai');
  saveState();
  bindEvents();
  render();
  requestAnimationFrame(scrollToUsefulHours);
}

function syncControlsFromState() {
  zoneSelect.value = state.zone;
  $('rangeMode').value = state.rangeMode;
  $('restStart').value = state.restStart;
  $('restEnd').value = state.restEnd;
}

function bindEvents() {
  zoneSelect.addEventListener('change', () => {
    state.zone = zoneSelect.value;
    state.weekStart = preferredStart();
    saveState(); render(); requestAnimationFrame(scrollToUsefulHours);
  });
  $('rangeMode').addEventListener('change', () => {
    state.rangeMode = $('rangeMode').value;
    state.weekStart = preferredStart();
    saveState(); render(); requestAnimationFrame(scrollToUsefulHours);
  });
  ['restStart', 'restEnd'].forEach(id => $(id).addEventListener('change', () => {
    state.restStart = $('restStart').value;
    state.restEnd = $('restEnd').value;
    saveState(); render();
  }));
  $('prevWeek').addEventListener('click', () => { state.weekStart = addDays(state.weekStart, -7); saveState(); render(); });
  $('nextWeek').addEventListener('click', () => { state.weekStart = addDays(state.weekStart, 7); saveState(); render(); });
  $('todayBtn').addEventListener('click', () => { state.weekStart = preferredStart(); saveState(); render(); requestAnimationFrame(scrollToUsefulHours); });
  $('sessionForm').addEventListener('submit', addSession);
  $('exportBackup').addEventListener('click', exportBackup);
  $('importBackup').addEventListener('change', importBackup);
  $('mobileSettingsBtn').addEventListener('click', () => toggleMobileSettings());
  $('sidebarBackdrop').addEventListener('click', () => toggleMobileSettings(false));
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') toggleMobileSettings(false);
  });
  $('clearSessions').addEventListener('click', () => {
    if (!state.sessions.length || confirm('确定清空全部已占用时段吗？')) { state.sessions = []; saveState(); render(); showToast('已清空占用时段'); }
  });
  $('screenshotBtn').addEventListener('click', () => {
    document.body.classList.toggle('shot-mode');
    $('screenshotBtn').textContent = document.body.classList.contains('shot-mode') ? '退出截图模式' : '截图模式';
  });
  window.addEventListener('pointerup', () => { if (drag) { drag = null; renderSessionList(); updateSummary(); } });
}

function toggleMobileSettings(force) {
  const sidebar = $('sidebar');
  const button = $('mobileSettingsBtn');
  const backdrop = $('sidebarBackdrop');
  const open = typeof force === 'boolean' ? force : !sidebar.classList.contains('mobile-open');
  sidebar.classList.toggle('mobile-open', open);
  button.setAttribute('aria-expanded', String(open));
  backdrop.hidden = !open;
  document.body.classList.toggle('settings-open', open);
}

function addSession(event) {
  event.preventDefault();
  const date = $('sessionDate').value;
  const startTime = $('sessionStart').value;
  const endTime = $('sessionEnd').value;
  const type = selectedSessionType();
  const note = $('sessionNote').value.trim() || typeLabel(type);
  const start = beijingToUtc(date, startTime);
  let end = beijingToUtc(date, endTime);
  if (end <= start) end += 24 * 60 * 60000;
  if (end - start > 24 * 60 * 60000) { $('formError').textContent = '单个时段不能超过 24 小时。'; return; }
  if (state.sessions.some(s => start < s.end && end > s.start)) { $('formError').textContent = '该时段与已有占用重叠，请先删除或调整已有记录。'; return; }
  $('formError').textContent = '';
  state.sessions.push({ id: createId(), start, end, type, note });
  normalizeSessions(); saveState();
  $('sessionNote').value = '';
  render(); showToast(`已添加${typeLabel(type)}`);
}

function render() {
  renderCalendar();
  renderSessionList();
  updateSummary();
}

function renderCalendar() {
  calendarGrid.innerHTML = '';
  const zone = state.zone;
  const zoneMeta = ZONES.find(z => z.id === zone);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
  const today = localDateNow(zone);
  $('zoneCaption').textContent = `${zoneMeta.short} · ${zoneOffsetLabel(zone, zonedToUtc(state.weekStart, '12:00', zone))}`;
  const first = parseDateKey(weekDates[0]);
  const last = parseDateKey(weekDates[6]);
  const rangeTitle = first.month === last.month
    ? `${first.year}年${first.month}月 ${first.day}–${last.day}日`
    : `${first.month}月${first.day}日 – ${last.month}月${last.day}日`;
  $('weekTitle').textContent = state.rangeMode === 'today' ? `未来 7 天 · ${rangeTitle}` : rangeTitle;
  $('todayBtn').textContent = state.rangeMode === 'today' ? '今天' : '本周';

  calendarGrid.append(makeCell('div', 'corner'));
  weekDates.forEach((date, i) => {
    const p = parseDateKey(date);
    const el = makeCell('div', `day-head${date === today ? ' today' : ''}${i > 4 ? ' weekend' : ''}`);
    const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(p.year, p.month - 1, p.day)));
    el.innerHTML = `<span class="weekday">${weekday}</span><span class="date">${p.day}</span>`;
    calendarGrid.append(el);
  });

  for (let index = 0; index < 48; index++) {
    const hour = Math.floor(index / 2), minute = index % 2 ? 30 : 0;
    const timeLabel = makeCell('div', 'time-label');
    timeLabel.textContent = minute === 0 ? `${pad(hour)}:00` : '';
    calendarGrid.append(timeLabel);
    weekDates.forEach(date => {
      const instant = zonedToUtc(date, `${pad(hour)}:${pad(minute)}`, zone);
      const session = sessionAt(instant);
      const status = session ? 'busy' : isRest(instant) ? 'rest' : 'free';
      const busyType = session ? ` ${session.type === 'personal' ? 'personal' : 'lesson'}` : '';
      const slot = makeCell('div', `slot ${status}${busyType}${minute === 0 ? ' hour' : ''}`);
      slot.dataset.start = String(instant);
      slot.title = `${formatDate(instant, zone)} ${formatTime(instant, zone)} · ${status === 'free' ? '可以预约' : status === 'rest' ? '休息' : `${typeLabel(session.type)} · ${session.note}`}`;
      if (session && (instant === session.start || !sessionAt(instant - SLOT_MINUTES * 60000))) {
        const label = makeCell('span', 'slot-label');
        label.textContent = session.note;
        slot.append(label);
      }
      slot.addEventListener('pointerdown', onSlotPointerDown);
      slot.addEventListener('pointerenter', onSlotPointerEnter);
      calendarGrid.append(slot);
    });
  }
}

function onSlotPointerDown(event) {
  event.preventDefault();
  const start = Number(event.currentTarget.dataset.start);
  drag = { makeBusy: !isBusy(start), type: selectedSessionType(), touched: new Set() };
  paintSlot(event.currentTarget);
}
function onSlotPointerEnter(event) { if (drag && event.buttons) paintSlot(event.currentTarget); }
function paintSlot(el) {
  const start = Number(el.dataset.start);
  if (drag.touched.has(start)) return;
  drag.touched.add(start);
  setSlotBusy(start, drag.makeBusy, drag.type);
  const session = sessionAt(start);
  const busyType = session ? ` ${session.type === 'personal' ? 'personal' : 'lesson'}` : '';
  el.className = `slot ${session ? 'busy' : isRest(start) ? 'rest' : 'free'}${busyType}${partsInZone(start, state.zone).minute === 0 ? ' hour' : ''}`;
}

function renderSessionList() {
  const list = $('sessionList');
  list.innerHTML = '';
  const upcoming = [...state.sessions].sort((a, b) => a.start - b.start);
  if (!upcoming.length) {
    const empty = makeCell('div', 'empty-list');
    empty.textContent = '还没有已占用时段';
    list.append(empty); return;
  }
  upcoming.forEach(s => {
    const itemType = s.type === 'personal' ? 'personal' : 'lesson';
    const row = makeCell('div', `session-item ${itemType}`);
    const info = document.createElement('div');
    info.innerHTML = `<span class="session-type-label">${typeLabel(itemType)}</span><strong>${escapeHtml(s.note || typeLabel(itemType))}</strong><span>${formatDate(s.start, 'Asia/Shanghai', true)} · ${formatTime(s.start, 'Asia/Shanghai')}–${formatTime(s.end, 'Asia/Shanghai')}</span>`;
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = '×'; remove.title = '删除该时段'; remove.setAttribute('aria-label', '删除该时段');
    remove.addEventListener('click', () => { state.sessions = state.sessions.filter(x => x.id !== s.id); saveState(); render(); });
    row.append(info, remove); list.append(row);
  });
}

function updateSummary() {
  let free = 0, lessons = 0, personal = 0;
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
  for (const date of weekDates) for (let i = 0; i < 48; i++) {
    const instant = zonedToUtc(date, `${pad(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`, state.zone);
    const session = sessionAt(instant);
    if (session) session.type === 'personal' ? personal++ : lessons++;
    else if (!isRest(instant)) free++;
  }
  $('footerSummary').textContent = `可预约 ${free / 2} 小时 · 已排课 ${lessons / 2} 小时 · 个人事务 ${personal / 2} 小时`;
}

function scrollToUsefulHours() {
  const zone = state.zone;
  const today = localDateNow(zone);
  let firstFree = 8;
  for (let h = 0; h < 24; h++) {
    if (!isRest(zonedToUtc(today, `${pad(h)}:00`, zone))) { firstFree = h; break; }
  }
  $('calendarScroll').scrollTop = Math.max(0, firstFree * 50 - 35);
}
function makeCell(tag, className) { const el = document.createElement(tag); el.className = className; return el; }
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function showToast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}

init();
