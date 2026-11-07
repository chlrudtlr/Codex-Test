import { WEEKDAYS, dateKey, parseDate, monthDates, newItem, taskStats, scheduleItems, groupEnd, canIndent } from '../shared/model.js';
import { THEMES, isTheme } from '../shared/themes.js';
import { validateExportRange } from '../shared/export.js';

const $ = id => document.getElementById(id);
const api = window.daynote;
let data = { version: 1, days: {} };
let today = dateKey(new Date());
let selected = today;
let month = parseDate(selected);
let revision = 0;
let savedRevision = 0;
let saveTimer;
let loading = true;
let resizeFrame;
let currentTheme = 'green';
const editorFocusGeneration = { schedule: 0, todo: 0 };
let exportInProgress = false;

$('export-button').addEventListener('click', () => {
  if (loading || exportInProgress) return;
  $('export-start').value = dateKey(new Date(month.getFullYear(), month.getMonth(), 1, 12));
  $('export-end').value = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0, 12));
  $('export-status').textContent = '';
  $('export-status').className = '';
  $('export-dialog').showModal();
  $('export-start').focus();
});
for (const id of ['close-export', 'cancel-export']) {
  $(id).addEventListener('click', () => { if (!exportInProgress) $('export-dialog').close(); });
}
$('export-dialog').addEventListener('cancel', event => { if (exportInProgress) event.preventDefault(); });
$('export-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (exportInProgress) return;
  const start = $('export-start').value;
  const end = $('export-end').value;
  const message = $('export-status');
  message.className = '';
  try { validateExportRange(start, end); }
  catch (error) { message.textContent = error.message; message.className = 'error'; return; }
  exportInProgress = true;
  const controls = ['export-button', 'export-start', 'export-end', 'confirm-export', 'close-export', 'cancel-export'];
  for (const id of controls) $(id).disabled = true;
  $('export-form').setAttribute('aria-busy', 'true');
  $('confirm-export').textContent = '내보내는 중…';
  message.textContent = '저장 위치를 선택해주세요.';
  try {
    const result = await api.exportTodo({ start, end, data: structuredClone(data) });
    if (result.status === 'saved') {
      $('export-dialog').close();
      notify(`할 일 ${result.count}개를 Excel 파일로 저장했습니다.`);
    } else if (result.status === 'empty') {
      message.textContent = '해당 기간에 내보낼 할 일이 없습니다. 기간을 변경해주세요.';
    } else if (result.status === 'canceled') {
      message.textContent = '저장을 취소했습니다. 기간을 유지한 채 다시 시도할 수 있습니다.';
    } else {
      message.textContent = result.message || '내보내지 못했습니다. 잠시 후 다시 시도해주세요.';
      message.className = 'error';
    }
  } catch {
    message.textContent = '파일을 저장하지 못했습니다. 다른 저장 위치를 선택하거나 열려 있는 Excel 파일을 닫고 다시 시도해주세요.';
    message.className = 'error';
  } finally {
    exportInProgress = false;
    for (const id of controls) $(id).disabled = false;
    $('export-form').setAttribute('aria-busy', 'false');
    $('confirm-export').textContent = 'Export';
  }
});

function applyTheme(value) {
  currentTheme = isTheme(value) ? value : 'green';
  document.documentElement.dataset.theme = currentTheme;
  for (const radio of document.querySelectorAll('input[name="theme"]')) radio.checked = radio.value === currentTheme;
}

for (const theme of THEMES) {
  const option = document.createElement('label');
  option.className = 'theme-option'; option.dataset.themeChoice = theme.id;
  const radio = document.createElement('input');
  radio.type = 'radio'; radio.name = 'theme'; radio.value = theme.id;
  const swatch = document.createElement('span'); swatch.className = 'theme-swatch'; swatch.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span'); text.textContent = theme.label;
  option.append(radio, swatch, text); $('theme-options').append(option);
  radio.addEventListener('change', async () => {
    const previous = currentTheme;
    applyTheme(theme.id);
    const radios = document.querySelectorAll('input[name="theme"]');
    for (const input of radios) input.disabled = true;
    $('theme-status').textContent = '테마 저장 중';
    try {
      const updated = await api.setTheme(theme.id);
      applyTheme(updated.theme);
      $('theme-status').textContent = '테마가 저장되었습니다.';
    } catch {
      applyTheme(previous);
      $('theme-status').textContent = '테마를 저장하지 못했습니다. 다시 선택해주세요.';
    } finally {
      for (const input of radios) input.disabled = false;
    }
  });
}

function icon(name, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function day() {
  return data.days[selected] ??= { schedule: [], todo: [] };
}

function notify(message) {
  $('toast-message').textContent = message;
  $('toast').hidden = false;
}

function status(type, text) {
  $('save-status').className = `save-status ${type}`;
  $('save-label').textContent = text;
}

async function save() {
  clearTimeout(saveTimer);
  if (loading || savedRevision === revision) return;
  const savingRevision = revision;
  // Snapshot before invoking the bridge: later keystrokes belong to a newer save.
  const snapshot = structuredClone(data);
  try {
    await api.save(snapshot);
    savedRevision = Math.max(savedRevision, savingRevision);
    if (revision === savedRevision) status('', '자동 저장됨');
  } catch {
    status('error', '저장 실패 · 다시 시도');
    notify('저장하지 못했습니다. 저장 공간을 확인한 뒤 상단의 저장 상태를 눌러 다시 시도해주세요.');
  }
}

function changed() {
  revision++;
  status('saving', '저장 중');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 220);
  updateDayStats();
  updateCalendarDay(selected);
}

function selectDate(key) {
  void save();
  selected = key;
  month = parseDate(key);
  month.setDate(1);
  renderCalendar();
  renderDay();
}

function renderCalendar() {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  $('month-heading').textContent = `${year}년 ${monthIndex + 1}월`;
  const dates = monthDates(year, monthIndex);
  const grid = $('calendar-grid');
  grid.replaceChildren();
  grid.style.gridTemplateRows = `repeat(${dates.length / 7}, minmax(0, 1fr))`;
  for (const date of dates) {
    const key = dateKey(date);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'day-cell';
    cell.dataset.date = key;
    cell.classList.toggle('outside', date.getMonth() !== monthIndex);
    cell.classList.toggle('today', key === today);
    cell.classList.toggle('selected', key === selected);
    cell.classList.toggle('sunday', date.getDay() === 0);
    cell.classList.toggle('saturday', date.getDay() === 6);
    cell.setAttribute('aria-pressed', String(key === selected));
    if (key === today) cell.setAttribute('aria-current', 'date');
    cell.tabIndex = key === selected ? 0 : -1;
    const number = document.createElement('div');
    number.className = 'day-number';
    const label = document.createElement('span');
    label.textContent = date.getDate();
    number.append(label);
    if (key === today) {
      const marker = document.createElement('span');
      marker.className = 'today-marker'; marker.textContent = '오늘'; number.append(marker);
    }
    const events = document.createElement('div'); events.className = 'cell-events';
    const progress = document.createElement('div'); progress.className = 'day-progress';
    cell.append(number, events, progress);
    cell.addEventListener('click', () => selectDate(key));
    cell.addEventListener('keydown', event => {
      const movement = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
      if (movement === undefined) return;
      event.preventDefault();
      const next = parseDate(key); next.setDate(next.getDate() + movement);
      const nextKey = dateKey(next); selectDate(nextKey);
      document.querySelector(`[data-date="${nextKey}"]`)?.focus();
    });
    grid.append(cell);
    updateCalendarDay(key);
  }
  scheduleCalendarLayout();
}

function updateCalendarDay(key) {
  const cell = document.querySelector(`.day-cell[data-date="${key}"]`);
  if (!cell) return;
  const entry = data.days[key];
  const stats = taskStats(entry?.todo);
  const progress = cell.querySelector('.day-progress');
  progress.textContent = stats.total ? `완료 ${stats.completed}/전체 ${stats.total}` : '';
  progress.classList.toggle('all-done', stats.total > 0 && stats.total === stats.completed);
  const date = parseDate(key);
  cell.setAttribute('aria-label', `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일, 일정 ${scheduleItems(entry).length}개, 완료 ${stats.completed}/전체 ${stats.total}`);
  drawSchedulePreview(cell, entry);
}

function drawSchedulePreview(cell, entry) {
  const container = cell.querySelector('.cell-events');
  const items = scheduleItems(entry);
  container.replaceChildren();
  const available = container.clientHeight;
  const capacity = Math.max(0, Math.floor(available / 21));
  const visibleCount = items.length <= capacity ? items.length : Math.max(0, Math.floor((available - 16) / 21));
  for (const item of items.slice(0, visibleCount)) {
    const line = document.createElement('div'); line.className = 'event-line'; line.title = item.text;
    const mark = item.checked ? icon('check', 'icon event-check') : document.createElement('span');
    if (!item.checked) mark.className = 'event-dot';
    const text = document.createElement('span'); text.className = 'event-text'; text.textContent = item.text;
    line.append(mark, text); container.append(line);
  }
  if (items.length > visibleCount) {
    const more = document.createElement('div'); more.className = 'more-events';
    more.textContent = `+${items.length - visibleCount}개`; container.append(more);
  }
}

function scheduleCalendarLayout() {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    for (const cell of document.querySelectorAll('.day-cell')) drawSchedulePreview(cell, data.days[cell.dataset.date]);
  });
}

function renderDay() {
  const date = parseDate(selected);
  const heading = $('selected-heading');
  heading.textContent = `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
  const weekday = document.createElement('span'); weekday.textContent = `${WEEKDAYS[date.getDay()]}요일`; heading.append(weekday);
  $('selected-today').hidden = selected !== today;
  renderEditor('schedule');
  renderEditor('todo');
  updateDayStats();
}

function updateDayStats() {
  const current = data.days[selected];
  const stats = taskStats(current?.todo);
  const percent = stats.total ? Math.round(stats.completed / stats.total * 100) : 0;
  $('todo-progress-text').textContent = `완료 ${stats.completed} / 전체 ${stats.total}`;
  $('todo-progress-percent').textContent = `${percent}%`;
  $('todo-progress-fill').style.width = `${percent}%`;
  document.querySelector('.progress-track').setAttribute('aria-valuenow', percent);
  $('schedule-count').textContent = scheduleItems(current).length;
}

function autoHeight(textarea) {
  textarea.style.height = '0px';
  textarea.style.height = `${Math.max(21, textarea.scrollHeight)}px`;
}

function renderEditor(section, focusId, caret) {
  const focusGeneration = ++editorFocusGeneration[section];
  const container = $(`${section}-editor`);
  const scroll = container.scrollTop;
  container.replaceChildren();
  const items = day()[section];
  if (!items.length) items.push(newItem());
  const name = section === 'todo' ? '할 일' : '일정';
  items.forEach((item, index) => {
    const row = document.createElement('div'); row.className = `item-row ${item.type}`; row.dataset.id = item.id;
    if (item.type === 'task') {
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = item.checked;
      checkbox.setAttribute('aria-label', `${name} ${index + 1} 완료`);
      checkbox.addEventListener('change', () => { item.checked = checkbox.checked; changed(); });
      row.append(checkbox);
    } else {
      const mark = document.createElement('span'); mark.className = 'note-mark'; mark.setAttribute('aria-hidden', 'true'); row.append(mark);
    }
    const textarea = document.createElement('textarea');
    textarea.rows = 1; textarea.value = item.text; textarea.spellcheck = false;
    textarea.setAttribute('aria-label', `${name}${item.type === 'note' ? ' 설명' : ''} ${index + 1}`);
    textarea.placeholder = item.type === 'note' ? '위 항목의 설명을 입력하세요' : `${name === '일정' ? '일정' : '할 일'}을 입력하세요`;
    textarea.addEventListener('input', () => { item.text = textarea.value; autoHeight(textarea); changed(); });
    textarea.addEventListener('keydown', event => handleKey(event, section, item, textarea));
    textarea.addEventListener('paste', event => pasteLines(event, section, item, textarea));
    row.append(textarea);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button delete-item';
    remove.setAttribute('aria-label', `${name}${item.type === 'note' ? ' 설명' : ''} ${index + 1} 삭제`);
    remove.title = '삭제'; remove.append(icon('close'));
    remove.addEventListener('click', event => deleteItem(section, item.id, event.detail === 0));
    row.append(remove); container.append(row);
  });
  container.scrollTop = scroll;
  // Keep the selected day's editor height correct after font/layout changes.
  requestAnimationFrame(() => {
    for (const textarea of container.querySelectorAll('textarea')) autoHeight(textarea);
    if (focusId && focusGeneration === editorFocusGeneration[section]) {
      const field = container.querySelector(`[data-id="${focusId}"] textarea`);
      field?.focus();
      if (field) field.setSelectionRange(caret ?? field.value.length, caret ?? field.value.length);
      field?.scrollIntoView({ block: 'nearest' });
    }
  });
}

function handleKey(event, section, item, textarea) {
  // Enter during Korean IME composition must only commit the syllable.
  if (event.isComposing || event.keyCode === 229) return;
  const items = day()[section];
  const index = items.findIndex(entry => entry.id === item.id);
  if (event.key === 'Enter') {
    event.preventDefault();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = newItem('task', item.text.slice(end));
    item.text = item.text.slice(0, start);
    items.splice(groupEnd(items, index), 0, next);
    renderEditor(section, next.id, 0); changed();
  } else if (event.key === 'Tab') {
    event.preventDefault();
    if (event.shiftKey) {
      if (item.type === 'note') { item.type = 'task'; item.checked = false; renderEditor(section, item.id, textarea.selectionStart); changed(); }
      else document.getElementById(`add-${section}`).focus();
    } else if (item.type === 'task') {
      if (!canIndent(items, index)) { notify('설명은 체크박스 항목 아래에 만들 수 있습니다. Enter로 새 항목을 만든 뒤 Tab을 눌러주세요.'); return; }
      item.type = 'note'; item.checked = false;
      renderEditor(section, item.id, textarea.selectionStart); changed();
    } else {
      const next = containerField(section, index + 1);
      if (next) next.focus(); else document.getElementById(`add-${section}`).focus();
    }
  } else if (event.key === 'Backspace' && !textarea.value && !event.altKey && !event.ctrlKey && !event.metaKey) {
    if (items.length > 1) { event.preventDefault(); deleteItem(section, item.id, true); }
  } else if (event.key === 'ArrowUp' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
    const previous = containerField(section, index - 1);
    if (previous) { event.preventDefault(); previous.focus(); previous.setSelectionRange(previous.value.length, previous.value.length); }
  } else if (event.key === 'ArrowDown' && textarea.selectionStart === textarea.value.length) {
    const next = containerField(section, index + 1);
    if (next) { event.preventDefault(); next.focus(); next.setSelectionRange(0, 0); }
  }
}

function containerField(section, index) {
  return $(`${section}-editor`).querySelectorAll('textarea')[index];
}

function pasteLines(event, section, item, textarea) {
  const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
  if (!text.includes('\n')) return;
  event.preventDefault();
  const lines = text.split('\n');
  const items = day()[section];
  const index = items.findIndex(entry => entry.id === item.id);
  const suffix = item.text.slice(textarea.selectionEnd);
  item.text = item.text.slice(0, textarea.selectionStart) + lines.shift();
  const additions = lines.map(line => newItem('task', line));
  additions.at(-1).text += suffix;
  items.splice(groupEnd(items, index), 0, ...additions);
  renderEditor(section, additions.at(-1).id); changed();
}

function addItem(section) {
  const items = day()[section];
  const last = items.at(-1);
  if (last?.type === 'task' && !last.text.trim()) { renderEditor(section, last.id); return; }
  const item = newItem(); items.push(item);
  renderEditor(section, item.id); changed();
}

function deleteItem(section, id, keepEditing = false) {
  const items = day()[section];
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return;
  const end = items[index].type === 'task' ? groupEnd(items, index) : index + 1;
  items.splice(index, end - index);
  // Keep keyboard users in the editor after the focused row is removed.
  const focus = items[Math.max(0, index - 1)]?.id;
  renderEditor(section, keepEditing ? focus : undefined);
  if (keepEditing && !focus) $(`add-${section}`).focus();
  changed();
}

$('dismiss-toast').addEventListener('click', () => { $('toast').hidden = true; });
$('save-status').addEventListener('click', () => { if (!loading) void save(); });
$('add-schedule').addEventListener('click', () => addItem('schedule'));
$('add-todo').addEventListener('click', () => addItem('todo'));
for (const section of ['schedule', 'todo']) {
  $(`${section}-editor`).addEventListener('pointerdown', event => {
    // A later mouse action takes priority over an earlier queued keyboard focus.
    editorFocusGeneration[section]++;
    // Blank space only ends editing; creating an item requires Enter or +.
    if (!event.target.closest('textarea, button, input') && document.activeElement instanceof HTMLTextAreaElement) {
      document.activeElement.blur();
    }
  });
}

function moveMonth(offset) {
  const next = new Date(month.getFullYear(), month.getMonth() + offset, 1, 12);
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0, 12).getDate();
  next.setDate(Math.min(parseDate(selected).getDate(), last));
  selectDate(dateKey(next));
}
$('previous-month').addEventListener('click', () => moveMonth(-1));
$('next-month').addEventListener('click', () => moveMonth(1));
$('today-button').addEventListener('click', () => { today = dateKey(new Date()); selectDate(today); });

function applySettings(settings) {
  applyTheme(settings.theme);
  $('auto-launch').checked = settings.autoLaunch;
  $('auto-launch').disabled = !settings.autoLaunchSupported;
  $('data-path').textContent = settings.dataPath;
  $('app-version').textContent = `Daynote ${settings.version}`;
  $('auto-launch-help').textContent = settings.autoLaunchSupported
    ? '자동 실행 여부는 운영체제의 시작 앱 설정에서도 변경할 수 있습니다.'
    : !settings.packaged ? '자동 실행은 설치된 Windows 또는 macOS 앱에서 설정할 수 있습니다.' : '이 운영체제에서는 자동 실행 설정을 지원하지 않습니다.';
}

$('settings-button').addEventListener('click', async () => {
  try {
    applySettings(await api.settings());
    if (!$('settings-dialog').open) $('settings-dialog').showModal();
  } catch { notify('설정을 불러오지 못했습니다. 다시 시도해주세요.'); }
});
$('auto-launch').addEventListener('change', async event => {
  const toggle = event.target;
  const value = toggle.checked; toggle.disabled = true;
  try { applySettings(await api.setAutoLaunch(value)); }
  catch { toggle.checked = !value; toggle.disabled = false; notify('자동 실행을 변경하지 못했습니다. 운영체제의 시작 앱 설정을 확인해주세요.'); }
});
for (const id of ['close-settings', 'settings-done']) $(id).addEventListener('click', () => $('settings-dialog').close());
$('settings-dialog').addEventListener('click', event => { if (event.target === event.currentTarget) {
  const bounds = event.currentTarget.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
} });

window.addEventListener('beforeunload', event => {
  clearTimeout(saveTimer);
  if (loading || revision === savedRevision) return;
  try {
    const result = api.flush(data);
    if (!result.ok) throw new Error(result.message);
    savedRevision = revision;
  } catch {
    event.preventDefault(); event.returnValue = false;
    status('error', '저장 실패 · 다시 시도');
    notify('변경 내용을 저장하지 못해 창을 열어두었습니다. 저장 공간을 확인하고 다시 시도해주세요.');
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) void save(); });
window.addEventListener('focus', () => {
  const current = dateKey(new Date());
  if (current !== today) { today = current; renderCalendar(); $('selected-today').hidden = selected !== today; }
});
new ResizeObserver(() => {
  scheduleCalendarLayout();
  for (const field of document.querySelectorAll('.item-editor textarea')) autoHeight(field);
}).observe($('calendar-grid'));

async function initialize() {
  renderCalendar();
  try {
    if (!api) throw new Error('desktop-only');
    const loaded = await api.load(); data = loaded.data;
    applyTheme(loaded.theme);
    await document.fonts.ready;
    renderCalendar(); renderDay();
    loading = false;
    $('export-button').disabled = false;
    document.querySelector('.workspace').setAttribute('aria-busy', 'false');
    status('', '자동 저장됨');
    if (loaded.recoveryMessage) notify(loaded.recoveryMessage);
  } catch {
    status('error', '불러오기 실패');
    notify(api ? '기록을 불러오지 못했습니다. 앱을 다시 실행해주세요.' : 'Daynote는 데스크톱 앱입니다. npm start 명령으로 실행해주세요.');
  }
}
void initialize();
