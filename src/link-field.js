import { linkedPaste, shiftLinks, expandedLinks } from '../shared/links.js';

const popover = document.getElementById('link-name-popover');
const nameField = document.getElementById('link-name');
const addressField = document.getElementById('link-address');
let editing;

function closeEditor() {
  popover.hidePopover();
  editing?.field.focus({ preventScroll: true });
  editing = undefined;
}

document.getElementById('cancel-link-name').addEventListener('click', closeEditor);
document.getElementById('link-name-form').addEventListener('submit', event => {
  event.preventDefault();
  const label = nameField.value.trim();
  if (!label || /[\r\n]/.test(label)) { nameField.focus(); return; }
  const target = editing;
  if (!target?.field.isConnected) { closeEditor(); return; }
  closeEditor();
  target.rename(label);
});
popover.addEventListener('toggle', event => {
  if (event.newState === 'closed' && editing) {
    editing = undefined;
  }
});
popover.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeEditor(); }
});

export function bindLinkedField(field, { getLinks, onChange, openLink, multilinePaste }) {
  const element = document.createElement('div');
  element.className = `linked-editor${field.id === 'memo-content' ? ' memo-linked-editor' : ''}`;
  if (field.parentNode) field.replaceWith(element);
  element.append(field);
  const mirror = document.createElement('div');
  mirror.className = 'link-mirror';
  // The textarea remains the accessible editing surface. Ctrl+Enter opens
  // the link at its caret and F2 edits its name, without duplicate tab stops.
  mirror.setAttribute('aria-hidden', 'true');
  element.append(mirror);
  field.setAttribute('aria-describedby', 'link-help');
  let links = [];
  let previousText = field.value;
  let pending;
  const history = new Map();

  function remember() {
    history.delete(field.value);
    history.set(field.value, structuredClone(links));
    if (history.size > 100) history.delete(history.keys().next().value);
  }

  function render() {
    element.classList.toggle('has-links', links.length > 0);
    mirror.replaceChildren();
    let offset = 0;
    for (const link of links) {
      mirror.append(document.createTextNode(field.value.slice(offset, link.start)));
      const anchor = document.createElement('a');
      anchor.href = link.url;
      anchor.tabIndex = -1;
      anchor.textContent = field.value.slice(link.start, link.end);
      anchor.title = `${link.url}\nCtrl+클릭: 열기 · 우클릭: 표시 이름 변경`;
      mirror.append(anchor);
      offset = link.end;
    }
    mirror.append(document.createTextNode(field.value.slice(offset) + '\u200b'));
    syncLayout();
  }

  function syncLayout() {
    const style = getComputedStyle(field);
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']) {
      mirror.style[property] = style[property];
    }
    mirror.style.width = `${field.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`;
    mirror.style.height = `${field.offsetHeight}px`;
    mirror.scrollTop = field.scrollTop;
    mirror.scrollLeft = field.scrollLeft;
  }

  function linkAtPoint(event) {
    const anchors = mirror.querySelectorAll('a');
    for (let index = 0; index < anchors.length; index++) {
      for (const rect of anchors[index].getClientRects()) {
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) return links[index];
      }
    }
  }

  // Keep native caret placement and drag selection on the textarea. The
  // mirror supplies link styling and hit boxes without intercepting edits.
  field.addEventListener('pointermove', event => {
    const link = linkAtPoint(event);
    field.title = link ? `${link.url}\nCtrl+클릭: 열기 · 우클릭: 표시 이름 변경` : '';
  });
  field.addEventListener('pointerleave', () => { field.title = ''; });
  field.addEventListener('click', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    const link = linkAtPoint(event);
    if (link) { event.preventDefault(); void openLink(link.url); }
  });
  field.addEventListener('contextmenu', event => {
    const link = linkAtPoint(event);
    if (link) { event.preventDefault(); editName(link); }
  });

  function publish() {
    previousText = field.value;
    remember();
    onChange(field.value, structuredClone(links));
    render();
  }

  function insert(prepared, start = field.selectionStart, end = field.selectionEnd) {
    field.focus({ preventScroll: true });
    field.setSelectionRange(start, end);
    pending = {
      text: field.value.slice(0, start) + prepared.text + field.value.slice(end),
      links: [...shiftLinks(links, start, end, prepared.text.length),
        ...prepared.links.map(link => ({ ...link, start: start + link.start, end: start + link.end }))].sort((a, b) => a.start - b.start)
    };
    if (!document.execCommand('insertText', false, prepared.text)) {
      field.setRangeText(prepared.text, start, end, 'end');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const caret = start + prepared.text.length;
    field.setSelectionRange(caret, caret);
    // setSelectionRange does not reveal a caret already at the end after a
    // programmatic paste. Keep the final line visible in long memo bodies.
    if (caret === field.value.length) field.scrollTop = field.scrollHeight;
    syncLayout();
  }

  function editName(link) {
    const original = { ...link };
    editing = { field, rename(label) {
      const current = links.find(entry => entry.start === original.start && entry.end === original.end && entry.url === original.url);
      if (!current) return;
      insert({ text: label, links: [{ start: 0, end: label.length, url: current.url }] }, current.start, current.end);
    } };
    nameField.value = field.value.slice(link.start, link.end);
    addressField.value = link.url;
    popover.showPopover();
    const rect = field.getBoundingClientRect();
    popover.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - popover.offsetWidth - 12))}px`;
    popover.style.top = `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - popover.offsetHeight - 12))}px`;
    nameField.focus();
    nameField.select();
  }

  field.addEventListener('input', event => {
    if (pending && field.value === pending.text) links = pending.links;
    else if (['historyUndo', 'historyRedo'].includes(event.inputType) && history.has(field.value)) {
      links = structuredClone(history.get(field.value));
    } else {
      let start = 0;
      while (start < previousText.length && start < field.value.length && previousText[start] === field.value[start]) start++;
      let end = previousText.length;
      let newEnd = field.value.length;
      while (end > start && newEnd > start && previousText[end - 1] === field.value[newEnd - 1]) { end--; newEnd--; }
      links = shiftLinks(links, start, end, newEnd - start);
    }
    pending = undefined;
    publish();
  });
  field.addEventListener('paste', event => {
    const source = event.clipboardData.getData('text/plain');
    event.preventDefault();
    if (multilinePaste && /[\r\n]/.test(source)) multilinePaste(source);
    else insert(linkedPaste(source));
  });
  for (const type of ['copy', 'cut']) field.addEventListener(type, event => {
    const start = field.selectionStart;
    const end = field.selectionEnd;
    if (!links.some(link => link.start >= start && link.end <= end)) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', expandedLinks(field.value, links, start, end));
    if (type === 'cut') insert({ text: '', links: [] });
  });
  field.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    const link = links.find(entry => entry.start <= field.selectionStart && entry.end >= field.selectionEnd);
    if (!link) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault(); event.stopImmediatePropagation(); void openLink(link.url);
    } else if (event.key === 'F2') {
      event.preventDefault(); editName(link);
    }
  });
  field.addEventListener('scroll', syncLayout);
  const observer = new ResizeObserver(syncLayout);
  observer.observe(field);
  // Rows are rebuilt during Enter/Tab. Disconnect observers with their rows.
  const cleanup = new MutationObserver(() => {
    if (!element.isConnected) { observer.disconnect(); cleanup.disconnect(); }
  });
  cleanup.observe(document.getElementById('schedule-editor').parentElement.parentElement, { childList: true, subtree: true });

  function reset() {
    links = structuredClone(getLinks() ?? []);
    previousText = field.value;
    pending = undefined;
    history.clear(); remember(); render();
  }
  reset();
  return { element, reset, insert };
}
