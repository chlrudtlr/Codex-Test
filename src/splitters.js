// Save the preferred ratio and fit it to the available space on every resize.
function bindSplitter(id, horizontal, minimum, otherMinimum, initialRatio) {
  const handle = document.getElementById(id);
  const first = handle.previousElementSibling;
  const parent = handle.parentElement;
  const property = horizontal ? '--calendar-width' : '--schedule-height';
  const stored = Number(localStorage.getItem(id));
  let ratio = stored > 0 && stored < 1 ? stored : initialRatio;
  let grabOffset = 0;
  function measure() {
    const start = first.getBoundingClientRect()[horizontal ? 'left' : 'top'];
    const end = parent.getBoundingClientRect()[horizontal ? 'right' : 'bottom'];
    const size = end - start - (horizontal ? handle.offsetWidth : handle.offsetHeight);
    return { start, size, max: Math.max(minimum, size - otherMinimum) };
  }
  function update(desired) {
    if (!handle.offsetParent) return;
    const { size, max } = measure();
    const pixels = Math.min(max, Math.max(minimum, desired ?? ratio * size));
    if (desired !== undefined) ratio = pixels / size;
    parent.style.setProperty(property, pixels + 'px');
    for (const [key, value] of Object.entries({ min: minimum, max, now: pixels })) {
      handle.setAttribute('aria-value' + key, String(Math.round(value)));
    }
  }
  const coordinate = event => horizontal ? event.clientX : event.clientY;
  handle.onpointerdown = event => {
    if (event.button !== 0 || !event.isPrimary) return;
    grabOffset = coordinate(event) - handle.getBoundingClientRect()[horizontal ? 'left' : 'top'];
    handle.setPointerCapture(event.pointerId);
  };
  handle.onpointermove = event => {
    if (handle.hasPointerCapture(event.pointerId)) update(coordinate(event) - measure().start - grabOffset);
  };
  handle.onlostpointercapture = () => localStorage.setItem(id, ratio);
  handle.onkeydown = event => {
    const keys = horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const index = keys.indexOf(event.key);
    if (index < 0) return;
    event.preventDefault();
    update(Number(handle.getAttribute('aria-valuenow')) + (index ? 16 : -16));
    localStorage.setItem(id, ratio);
  };
  const observer = new ResizeObserver(() => update());
  observer.observe(parent);
  observer.observe(handle);
  update();
}
bindSplitter('column-split', true, 430, 320, 0.65);
bindSplitter('row-split', false, 140, 180, 0.33);
