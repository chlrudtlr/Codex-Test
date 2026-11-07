import { isDateKey } from './model.js';

export function validateExportRange(start, end) {
  if (typeof start !== 'string' || typeof end !== 'string' || !isDateKey(start) || !isDateKey(end)) {
    throw new Error('시작일과 종료일을 올바르게 선택해주세요.');
  }
  if (start > end) throw new Error('종료일은 시작일과 같거나 이후여야 합니다.');
}

export function collectTodoRows(data, start, end) {
  validateExportRange(start, end);
  const rows = [];
  for (const date of Object.keys(data.days).filter(key => key >= start && key <= end).sort().reverse()) {
    let current;
    const finish = () => {
      if (!current) return;
      const content = [current.text, ...current.notes.map(text => `• ${text}`)].filter(Boolean).join('\n');
      if (content) rows.push({ date, content, status: current.checked ? '완료' : '미완료' });
    };
    for (const item of data.days[date].todo) {
      if (item.type === 'task') {
        finish();
        current = { text: item.text.trim() ? item.text : '', checked: item.checked, notes: [] };
      } else if (current && item.text.trim()) current.notes.push(item.text);
    }
    finish();
  }
  return rows;
}
