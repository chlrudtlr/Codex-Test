export const THEMES = [
  { id: 'red', label: '빨강' },
  { id: 'orange', label: '주황' },
  { id: 'yellow', label: '노랑' },
  { id: 'green', label: '초록' },
  { id: 'blue', label: '파랑' },
  { id: 'indigo', label: '남색' },
  { id: 'violet', label: '보라' },
  { id: 'light', label: '밝은 테마' },
  { id: 'dark', label: '어두운 테마' }
];

export function isTheme(value) {
  return THEMES.some(theme => theme.id === value);
}
