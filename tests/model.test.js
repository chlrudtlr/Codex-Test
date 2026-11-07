import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, parseDate, monthDates, taskStats, scheduleItems, groupEnd, canIndent, validateData } from '../shared/model.js';

const task = (id, text, checked = false) => ({ id, text, checked, type: 'task' });
const note = (id, text) => ({ id, text, checked: false, type: 'note' });

test('월간 날짜는 일요일부터 시작하고 윤년과 연도 경계를 처리한다', () => {
  const february = monthDates(2024, 1);
  assert.equal(february[0].getDay(), 0);
  assert.equal(february.at(-1).getDay(), 6);
  assert.equal(february.filter(date => date.getMonth() === 1).length, 29);
  assert.equal(dateKey(monthDates(2026, 10)[0]), '2026-11-01');
  assert.equal(monthDates(2026, 7).length, 42);
  assert.equal(dateKey(parseDate('2027-01-01')), '2027-01-01');
});

test('진행률은 내용이 있는 체크박스만 세고 설명과 빈 항목은 제외한다', () => {
  assert.deepEqual(taskStats([task('1', '보고서', true), note('2', '부연 설명'), task('3', '회의'), task('4', ' ', true)]), { total: 2, completed: 1 });
  assert.deepEqual(taskStats(), { total: 0, completed: 0 });
  assert.equal(scheduleItems({ schedule: [task('1', '회의'), note('2', '장소'), task('3', '')] }).length, 1);
});

test('Enter로 추가할 위치는 기존 설명 뒤이며 첫 항목은 설명으로 바꿀 수 없다', () => {
  const items = [task('1', '회의'), note('2', '장소'), note('3', '준비물'), task('4', '보고서')];
  assert.equal(groupEnd(items, 0), 3);
  assert.equal(groupEnd(items, 1), 3);
  assert.equal(canIndent(items, 0), false);
  assert.equal(canIndent(items, 3), true);
});

test('날짜별 데이터는 독립적이고 검증 시 안전한 새 객체를 만든다', () => {
  const original = { version: 1, days: {
    '2026-11-07': { schedule: [], todo: [task('1', '오늘')] },
    '2026-11-08': { schedule: [], todo: [] }
  } };
  const copy = validateData(original);
  copy.days['2026-11-07'].todo[0].text = '수정';
  assert.equal(original.days['2026-11-07'].todo[0].text, '오늘');
  assert.equal(copy.days['2026-11-08'].todo.length, 0);
});

test('존재하지 않는 날짜, 중복 ID, 고아 설명, 다른 버전은 저장 전에 거부한다', () => {
  const data = (key, items) => ({ version: 1, days: { [key]: { schedule: [], todo: items } } });
  assert.throws(() => validateData(data('2026-02-30', [])));
  assert.throws(() => validateData(data('2026-11-07', [task('1', 'a'), task('1', 'b')])));
  assert.throws(() => validateData(data('2026-11-07', [note('1', '설명')])));
  assert.throws(() => validateData({ version: 2, days: {} }));
});
