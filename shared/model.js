export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDate(key) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date;
}

export function isDateKey(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && dateKey(parseDate(key)) === key;
}

export function monthDates(year, month) {
  const first = new Date(year, month, 1, 12);
  const days = new Date(year, month + 1, 0, 12).getDate();
  const count = Math.ceil((first.getDay() + days) / 7) * 7;
  return Array.from({ length: count }, (_, index) => new Date(year, month, 1 - first.getDay() + index, 12));
}

export function newItem(type = 'task', text = '') {
  return { id: crypto.randomUUID(), type, text, checked: false };
}

export function taskStats(items = []) {
  const tasks = items.filter(item => item.type === 'task' && item.text.trim());
  return { total: tasks.length, completed: tasks.filter(item => item.checked).length };
}

export function scheduleItems(day) {
  return (day?.schedule ?? []).filter(item => item.type === 'task' && item.text.trim());
}

// A description belongs to the closest preceding checkbox. New checkboxes go
// after that checkbox's descriptions, so Enter never moves an existing note.
export function groupEnd(items, index) {
  let end = index + 1;
  while (end < items.length && items[end].type === 'note') end++;
  return end;
}

export function canIndent(items, index) {
  return index > 0 && items.slice(0, index).some(item => item.type === 'task');
}

export function validateData(data) {
  if (!data || data.version !== 1 || !data.days || typeof data.days !== 'object' || Array.isArray(data.days)) {
    throw new Error('지원하지 않는 데이터 형식입니다.');
  }
  const days = {};
  for (const [key, day] of Object.entries(data.days)) {
    if (!isDateKey(key) || !day || typeof day !== 'object') throw new Error('날짜 데이터가 올바르지 않습니다.');
    days[key] = {};
    for (const section of ['schedule', 'todo']) {
      const items = day[section];
      if (!Array.isArray(items)) throw new Error('항목 목록이 올바르지 않습니다.');
      const ids = new Set();
      days[key][section] = items.map((item, index) => {
        if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
          !['task', 'note'].includes(item.type) || typeof item.text !== 'string' ||
          typeof item.checked !== 'boolean' || (index === 0 && item.type === 'note')) {
          throw new Error('업무 항목이 올바르지 않습니다.');
        }
        ids.add(item.id);
        return { id: item.id, type: item.type, text: item.text, checked: item.type === 'task' && item.checked };
      });
    }
  }
  const result = { version: 1, days };
  // Older calendar files have no notebook. Preserve their shape until used.
  if (Object.hasOwn(data, 'memos')) {
    if (!Array.isArray(data.memos)) throw new Error('메모 목록이 올바르지 않습니다.');
    const ids = new Set();
    result.memos = data.memos.map(memo => {
      if (!memo || typeof memo.id !== 'string' || !memo.id || ids.has(memo.id) ||
        typeof memo.title !== 'string' || typeof memo.content !== 'string') {
        throw new Error('메모가 올바르지 않습니다.');
      }
      ids.add(memo.id);
      return { id: memo.id, title: memo.title, content: memo.content };
    });
  }
  return result;
}
