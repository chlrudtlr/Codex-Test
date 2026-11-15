import test from 'node:test';
import assert from 'node:assert/strict';
import { webUrl, linkedPaste, linkLabel, shiftLinks, sliceLinks, expandedLinks } from '../shared/links.js';
import { validateData } from '../shared/model.js';
import { collectTodoRows } from '../shared/export.js';

test('웹 주소만 허용하고 로컬 파일·스크립트·제어문자 주소를 거부한다', () => {
  for (const value of ['https://example.com/한글?q=1#section', 'http://localhost:3000/a', 'HTTPS://example.com']) assert.equal(webUrl(value), value);
  for (const value of ['javascript:alert(1)', 'file:///C:/a.exe', 'data:text/html,test', '//example.com', 'https://', 'https://exa\nmple.com', 'https://example.com\u0000', 1, null]) assert.equal(webUrl(value), null);
});

test('여러 URL·한국어·괄호·문장부호·줄바꿈을 보존하며 표시만 줄인다', () => {
  const source = '자료 (https://example.com/a_(b)),\r\n참고 https://example.org/한글?q=abc#끝. 끝';
  const prepared = linkedPaste(source);
  assert.equal(prepared.links.length, 2);
  assert.equal(prepared.links[0].url, 'https://example.com/a_(b)');
  assert.equal(prepared.links[1].url, 'https://example.org/한글?q=abc#끝');
  assert.equal(expandedLinks(prepared.text, prepared.links), source.replace('\r\n', '\n'));
  assert.equal(linkLabel('https://docs.google.com/document/d/long/edit'), 'Google 문서');
  assert.ok([...linkLabel('https://example.com/' + 'a'.repeat(300))].length <= 42);
  assert.equal(linkedPaste('<img src=x onerror=alert(1)>').text, '<img src=x onerror=alert(1)>');
});

test('링크 앞뒤 편집·선택 삭제·줄 분리에서 주소와 오프셋을 유지한다', () => {
  const links = [{ start: 3, end: 8, url: 'https://example.com' }];
  assert.deepEqual(shiftLinks(links, 0, 0, 2), [{ ...links[0], start: 5, end: 10 }]);
  assert.deepEqual(shiftLinks(links, 8, 8, 2), links);
  assert.deepEqual(shiftLinks(links, 3, 3, 2), [{ ...links[0], start: 5, end: 10 }]);
  assert.deepEqual(shiftLinks(links, 4, 5, 2), []);
  assert.deepEqual(shiftLinks(links, 0, 10, 0), []);
  assert.deepEqual(sliceLinks(links, 2, 8), [{ ...links[0], start: 1, end: 6 }]);
  assert.deepEqual(sliceLinks(links, 4, 8), []);
});

test('저장 데이터의 링크는 독립 복사하고 오래된 데이터와 호환하며 잘못된 범위를 거부한다', () => {
  const item = { id: 't', type: 'task', text: '회의 자료', checked: false, links: [{ start: 0, end: 5, url: 'https://example.com' }] };
  const data = { version: 1, days: { '2026-11-15': { schedule: [structuredClone(item)], todo: [item] } },
    memos: [{ id: 'm', title: '참고', content: item.text, links: item.links }] };
  const copy = validateData(data);
  assert.deepEqual(copy, data);
  copy.memos[0].links[0].url = 'https://changed.example.com';
  assert.equal(data.memos[0].links[0].url, 'https://example.com');
  for (const links of [null, {}, [{ start: -1, end: 5, url: 'https://example.com' }],
    [{ start: 0, end: 99, url: 'https://example.com' }], [{ start: 1, end: 1, url: 'https://example.com' }],
    [{ start: 0, end: 5, url: 'javascript:alert(1)' }], [...item.links, ...item.links]]) {
    const invalid = structuredClone(data);
    invalid.days['2026-11-15'].todo[0].links = links;
    assert.throws(() => validateData(invalid));
  }
  const legacy = { version: 1, days: {}, memos: [{ id: 'm', title: '', content: '기존 본문' }] };
  assert.deepEqual(validateData(legacy), legacy);
});

test('TODO와 연결된 설명의 링크는 Excel용 텍스트에서 원래 주소로 복원한다', () => {
  const prepared = linkedPaste('https://example.com/' + 'a'.repeat(100));
  const data = { days: { '2026-11-15': { todo: [
    { ...prepared, type: 'task', checked: true }, { ...prepared, type: 'note' }
  ] } } };
  const rows = collectTodoRows(data, '2026-11-15', '2026-11-15');
  assert.equal(rows[0].content, `${prepared.links[0].url}\n• ${prepared.links[0].url}`);
  assert.equal(rows[0].status, '완료');
});
