import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { collectTodoRows, validateExportRange } from '../shared/export.js';
import { createTodoWorkbook, writeTodoWorkbook } from '../electron/export-excel.js';

const task = (text, checked = false) => ({ id: text, type: 'task', text, checked });
const note = text => ({ id: text, type: 'note', text, checked: false });
const day = todo => ({ schedule: [task('일정은 내보내지 않음')], todo });

test('양 끝 날짜를 포함하고 최신 날짜부터 완료·미완료와 설명을 나열한다', () => {
  const data = { version: 1, days: {
    '2026-11-09': day([task('범위 밖')]),
    '2026-11-07': day([task('첫 번째 업무', true), note('첫 번째 설명'), note('두 번째 설명'), task('미완료 업무'), task(' ')]),
    '2026-11-08': day([task('최신 업무', true)]),
    '2026-11-06': day([task('범위 밖')])
  } };
  const before = structuredClone(data);
  assert.deepEqual(collectTodoRows(data, '2026-11-07', '2026-11-08'), [
    { date: '2026-11-08', content: '최신 업무', status: '완료' },
    { date: '2026-11-07', content: '첫 번째 업무\n• 첫 번째 설명\n• 두 번째 설명', status: '완료' },
    { date: '2026-11-07', content: '미완료 업무', status: '미완료' }
  ]);
  assert.deepEqual(data, before);
});

test('같은 날짜, 윤년, 연도 경계와 빈 기간을 처리한다', () => {
  assert.doesNotThrow(() => validateExportRange('2024-02-29', '2024-02-29'));
  const data = { version: 1, days: {
    '2026-12-31': day([task('연말')]), '2027-01-01': day([task('새해')])
  } };
  assert.equal(collectTodoRows(data, '2026-12-31', '2027-01-01').length, 2);
  assert.equal(collectTodoRows(data, '2027-01-01', '2027-01-01').length, 1);
  assert.deepEqual(collectTodoRows(data, '2026-01-01', '2026-01-31'), []);
  for (const [start, end] of [['', '2026-11-08'], ['2026-02-29', '2026-11-08'], ['2026-11-09', '2026-11-08'], [null, '2026-11-08']]) {
    assert.throws(() => validateExportRange(start, end));
  }
});

test('제목 없는 설명도 보존하고, 빈 항목과 빈 설명은 제외한다', () => {
  const data = { version: 1, days: { '2026-11-08': day([task(''), note('설명만 있는 기록'), task(' '), note(' ')]) } };
  assert.deepEqual(collectTodoRows(data, '2026-11-08', '2026-11-08'), [
    { date: '2026-11-08', content: '• 설명만 있는 기록', status: '미완료' }
  ]);
});

test('생성된 실제 xlsx를 다시 읽어 세 열, 한국어·줄바꿈과 수식처럼 생긴 텍스트를 확인한다', async () => {
  const rows = [
    { date: '2026-11-08', content: '업무 <검토> & 확인\n• 설명', status: '완료' },
    { date: '2026-11-07', content: '=SUM(1,2)', status: '미완료' }
  ];
  const buffer = await createTodoWorkbook(rows);
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('업무 정리');
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['날짜', '업무 내용', '상태']);
  assert.deepEqual(sheet.getRow(2).values.slice(1), Object.values(rows[0]));
  assert.equal(sheet.getCell('B3').value, '=SUM(1,2)');
  assert.equal(sheet.getCell('B3').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('B2').alignment.wrapText, true);
  assert.equal(sheet.views[0].ySplit, 1);
});

test('파일을 완전히 쓴 다음 교체하며 임시 파일을 남기지 않는다', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'daynote-export-unit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, '업무.xlsx');
  await fs.writeFile(file, '이전 파일');
  await writeTodoWorkbook(file, [{ date: '2026-11-08', content: '확인', status: '완료' }]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  assert.equal(workbook.worksheets[0].getCell('C2').value, '완료');
  assert.deepEqual(await fs.readdir(directory), ['업무.xlsx']);
  await assert.rejects(writeTodoWorkbook(path.join(directory, '없는 폴더', '실패.xlsx'), []));
  assert.deepEqual(await fs.readdir(directory), ['업무.xlsx']);
});
