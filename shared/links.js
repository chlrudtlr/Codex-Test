// Ranges use UTF-16 offsets in displayed text; the destination stays separate.
export function webUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\s\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? value : null;
  } catch { return null; }
}

export function validateLinks(text, links) {
  if (!Array.isArray(links)) throw new Error('링크 목록이 올바르지 않습니다.');
  let previousEnd = 0;
  return links.map(link => {
    if (!link || !Number.isInteger(link.start) || !Number.isInteger(link.end) ||
        link.start < previousEnd || link.end <= link.start || link.end > text.length ||
        !text.slice(link.start, link.end).trim() || /[\r\n]/.test(text.slice(link.start, link.end)) || !webUrl(link.url)) {
      throw new Error('링크 정보가 올바르지 않습니다.');
    }
    previousEnd = link.end;
    return { start: link.start, end: link.end, url: link.url };
  });
}

export function linkLabel(value) {
  const url = new URL(value);
  if (url.hostname === 'docs.google.com') {
    const name = { document: 'Google 문서', spreadsheets: 'Google 스프레드시트', presentation: 'Google 프레젠테이션' }[url.pathname.split('/')[1]];
    if (name) return name;
  }
  let label = url.host + (url.pathname === '/' ? '' : url.pathname);
  try { label = decodeURI(label); } catch { /* Retain malformed percent escapes. */ }
  label = label.replace(/[\s\u0000-\u001f\u007f]/gu, '');
  const characters = [...label];
  return characters.length > 42 ? characters.slice(0, 41).join('') + '…' : label + (url.search || url.hash ? '…' : '');
}

export function linkedPaste(value) {
  const source = value.replace(/\r\n?/g, '\n');
  const links = [];
  let text = '';
  let offset = 0;
  for (const match of source.matchAll(/\bhttps?:\/\/[^\s<>"'\u0000-\u001f\u007f]+/giu)) {
    let url = match[0].replace(/[.,!?;:，。！？]+$/u, '');
    for (const [close, open] of [[')', '('], [']', '['], ['}', '{']]) {
      while (url.endsWith(close) && url.split(close).length > url.split(open).length) url = url.slice(0, -1);
    }
    if (!webUrl(url)) continue;
    text += source.slice(offset, match.index);
    const label = linkLabel(url);
    links.push({ start: text.length, end: text.length + label.length, url });
    text += label;
    offset = match.index + url.length;
  }
  return { text: text + source.slice(offset), links };
}

export function shiftLinks(links, start, end, insertedLength) {
  const shift = insertedLength - (end - start);
  return (links ?? []).flatMap(link => {
    if (link.end <= start) return [{ ...link }];
    if (link.start >= end) return [{ ...link, start: link.start + shift, end: link.end + shift }];
    // Direct edits inside a label make it plain text. Explicit renaming keeps it.
    return [];
  });
}

export function sliceLinks(links, start, end) {
  return (links ?? []).filter(link => link.start >= start && link.end <= end)
    .map(link => ({ ...link, start: link.start - start, end: link.end - start }));
}

export function setLinks(object, links) {
  if (links.length) object.links = links;
  else delete object.links;
}

export function expandedLinks(text, links, start = 0, end = text.length) {
  let result = '';
  let offset = start;
  for (const link of links ?? []) {
    if (link.start < start || link.end > end) continue;
    result += text.slice(offset, link.start) + link.url;
    offset = link.end;
  }
  return result + text.slice(offset, end);
}
