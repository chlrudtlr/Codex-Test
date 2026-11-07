export function visibleBounds(saved, displays) {
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) return null;
  const display = displays.find(({ workArea: area }) =>
    saved.x + saved.width > area.x + 80 && saved.x < area.x + area.width - 80 &&
    saved.y + saved.height > area.y + 80 && saved.y < area.y + area.height - 80);
  if (!display) return null;
  const area = display.workArea;
  const width = Math.min(Math.max(920, saved.width), area.width);
  const height = Math.min(Math.max(640, saved.height), area.height);
  return {
    width, height,
    x: Math.round(Math.max(area.x, Math.min(saved.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(saved.y, area.y + area.height - height)))
  };
}
