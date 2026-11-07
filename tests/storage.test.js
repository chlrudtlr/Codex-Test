import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DataStore } from '../electron/storage.js';
import { visibleBounds } from '../electron/window-state.js';

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daynote-unit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const state = text => ({ version: 1, days: { '2026-11-07': {
  schedule: [], todo: [{ id: 'a', text, checked: false, type: 'task' }]
} } });

test('저장한 업무를 새 인스턴스에서 복원하고 이전 상태를 백업한다', t => {
  const directory = temporary(t);
  const store = new DataStore(directory);
  store.save(state('첫 번째'));
  store.save(state('두 번째'));
  assert.deepEqual(new DataStore(directory).load(), state('두 번째'));
  assert.deepEqual(JSON.parse(fs.readFileSync(store.backup, 'utf8')), state('첫 번째'));
  assert.equal(fs.existsSync(`${store.file}.tmp`), false);
});

test('손상된 저장 파일은 보존하고 정상 백업으로 복구한다', t => {
  const directory = temporary(t);
  const store = new DataStore(directory);
  store.save(state('백업 내용'));
  store.save(state('최근 내용'));
  fs.writeFileSync(store.file, '{ damaged');
  const recovered = new DataStore(directory);
  assert.deepEqual(recovered.load(), state('백업 내용'));
  assert.match(recovered.recoveryMessage, /복원/);
  assert.ok(fs.readdirSync(directory).some(file => file.includes('.damaged-')));
  recovered.save(state('다시 저장'));
  assert.deepEqual(new DataStore(directory).load(), state('다시 저장'));
});

test('복구 불가능한 파일이나 잘못된 저장 요청이 기존 기록을 덮어쓰지 않는다', t => {
  const directory = temporary(t);
  const store = new DataStore(directory);
  store.save(state('보존할 기록'));
  assert.throws(() => store.save({ version: 999, days: {} }));
  assert.deepEqual(new DataStore(directory).load(), state('보존할 기록'));
  fs.unlinkSync(store.backup);
  fs.writeFileSync(store.file, 'broken');
  assert.throws(() => new DataStore(directory).load());
  assert.equal(fs.readFileSync(store.file, 'utf8'), 'broken');
});

test('창 위치는 연결된 모니터 안으로 보정하고 사라진 모니터의 위치는 버린다', () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  assert.equal(visibleBounds({ x: 2500, y: 100, width: 1000, height: 700 }, displays), null);
  assert.deepEqual(visibleBounds({ x: -20, y: -50, width: 1200, height: 800 }, displays), { x: 0, y: 0, width: 1200, height: 800 });
  assert.equal(visibleBounds({ x: 'bad' }, displays), null);
});
