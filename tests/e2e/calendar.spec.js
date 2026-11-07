import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let desktop;
let page;
let directory;
let errors;

async function launch() {
  desktop = await electron.launch({
    ...(process.env.DAYNOTE_ELECTRON_EXECUTABLE ? { executablePath: process.env.DAYNOTE_ELECTRON_EXECUTABLE } : {}),
    args: [...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'],
    cwd: process.cwd(),
    env: { ...process.env, DAYNOTE_TEST_DATA: directory }
  });
  page = await desktop.firstWindow();
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.workspace')).toHaveAttribute('aria-busy', 'false');
  // firstWindow resolves before ready-to-show: wait until the native window is
  // mapped before testing resize/restore, particularly on X11 without a WM.
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
}

test.beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'daynote-e2e-'));
  await launch();
});
test.afterEach(async () => {
  if (desktop) await desktop.close();
  await rm(directory, { recursive: true, force: true });
});

test('한국어 입력, Enter·Tab 설명, 진행률, 완료 표시, 날짜별 보존 및 재실행', async () => {
  const task = page.locator('#todo-editor textarea').first();
  await task.fill('보고서 작성');
  await task.press('End');
  await task.press('Enter');
  await expect(page.locator('#todo-editor textarea')).toHaveCount(2);
  await page.locator('#todo-editor textarea').nth(1).press('Tab');
  const description = page.locator('#todo-editor .note textarea');
  await description.fill('지난달 실적과 비교하고 주요 변경 사항을 정리합니다. '.repeat(4));
  expect(await description.evaluate(field => field.clientHeight)).toBeGreaterThan(21);
  await description.press('End');
  await description.press('Enter');
  await page.locator('#todo-editor textarea').nth(2).fill('회의 자료 준비');
  await page.locator('#todo-editor input[type=checkbox]').first().check();
  await expect(page.locator('#todo-progress-text')).toHaveText('완료 1 / 전체 2');
  const selected = page.locator('.day-cell.selected');
  const key = await selected.getAttribute('data-date');
  await expect(selected.locator('.day-progress')).toHaveText('완료 1/전체 2');
  expect(await task.evaluate(field => getComputedStyle(field).textDecorationLine)).toBe('none');
  await page.locator('#schedule-editor textarea').first().fill('14:00 부서 회의');
  await page.locator('#schedule-editor input[type=checkbox]').first().check();
  await expect(page.locator('#schedule-count')).toHaveText('1');
  await page.getByRole('button', { name: '다음 달', exact: true }).click();
  await expect(page.locator('#todo-progress-text')).toHaveText('완료 0 / 전체 0');
  await page.locator('#todo-editor textarea').fill('다음 달 업무');
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(page.locator('#todo-editor textarea').first()).toHaveValue('보고서 작성');
  await expect(page.locator('#save-label')).toHaveText('자동 저장됨');
  await desktop.close(); desktop = null;
  await launch();
  await expect(page.locator('.day-cell.selected')).toHaveAttribute('data-date', key);
  await expect(page.locator('#todo-editor textarea').first()).toHaveValue('보고서 작성');
  await expect(page.locator('#todo-editor .note textarea')).toHaveValue(/지난달 실적/);
  await expect(page.locator('#todo-progress-text')).toHaveText('완료 1 / 전체 2');
  await expect(page.locator('#schedule-editor input[type=checkbox]').first()).toBeChecked();
  expect(errors).toEqual([]);
});

test('긴 일정 생략, 숨겨진 개수, 작은 창에서도 진행률 표시', async () => {
  const schedule = page.locator('#schedule-editor textarea');
  await schedule.first().fill('아주 긴 일정 제목으로 캘린더 날짜 칸의 말줄임 표시를 확인하는 회의');
  for (let index = 0; index < 7; index++) {
    await page.getByRole('button', { name: '일정 추가', exact: true }).click();
    await schedule.last().fill(`추가 일정 ${index + 1}`);
  }
  await page.locator('#todo-editor textarea').fill('오늘 할 일');
  const cell = page.locator('.day-cell.selected');
  await expect(cell.locator('.more-events')).toHaveText(/\+\d+개/);
  const count = await cell.locator('.event-line').count();
  await expect(cell.locator('.more-events')).toHaveText(`+${8 - count}개`);
  if (count > 0) {
    expect(await cell.locator('.event-text').first().evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect(cell.locator('.event-text').first()).toHaveCSS('text-overflow', 'ellipsis');
  }
  await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(920, 640); });
  await expect(cell.locator('.day-progress')).toBeVisible();
  expect(await page.locator('body').evaluate(body => body.scrollHeight <= window.innerHeight)).toBe(true);
  await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 850); });
  await page.screenshot({ path: `test-results/calendar-${process.platform}.png` });
  expect(errors).toEqual([]);
});

test('설명 변환·삭제·실행 취소와 IME 조합 중 Enter 처리', async () => {
  let fields = page.locator('#todo-editor textarea');
  await fields.first().fill('기획서');
  await fields.first().evaluate(field => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  await expect(fields).toHaveCount(1);
  await fields.first().press('End'); await fields.first().press('Enter');
  await fields.nth(1).press('Tab');
  await page.locator('#todo-editor .note textarea').fill('참고 자료');
  await page.locator('#todo-editor .note textarea').press('Shift+Tab');
  await expect(page.locator('#todo-editor input[type=checkbox]')).toHaveCount(2);
  await fields.nth(1).press('Tab');
  await expect(page.locator('#todo-editor .note')).toHaveCount(1);
  await page.getByRole('button', { name: '할 일 1 삭제', exact: true }).click();
  await expect(page.locator('#todo-editor .note')).toHaveCount(0);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(fields.first()).toHaveValue('기획서');
  await expect(page.locator('#todo-editor .note textarea')).toHaveValue('참고 자료');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#auto-launch')).toBeDisabled();
  await expect(page.locator('#data-path')).toContainText(directory);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('저장 대기 중 창을 닫아도 마지막 입력을 보존하고 창 크기를 복원한다', async () => {
  const electronProcess = desktop.process();
  await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1100, 740); });
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().width)).toBe(1100);
  await expect.poll(async () => {
    try { return JSON.parse(await readFile(path.join(directory, 'window-state.json'), 'utf8')).width; }
    catch { return 0; }
  }).toBe(1100);
  // Close in the same renderer turn, before the 220ms autosave timer can fire.
  await page.locator('#todo-editor textarea').evaluate(field => {
    field.value = '닫기 직전의 업무';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => window.close(), 0);
  });
  if (process.platform === 'darwin') await desktop.close();
  await expect.poll(() => electronProcess.exitCode).not.toBeNull();
  desktop = null;
  const data = JSON.parse(await readFile(path.join(directory, 'calendar.json'), 'utf8'));
  expect(Object.values(data.days).some(day => day.todo.some(item => item.text === '닫기 직전의 업무'))).toBe(true);
  const savedBounds = JSON.parse(await readFile(path.join(directory, 'window-state.json'), 'utf8'));
  expect(savedBounds.width).toBe(1100);
  await launch();
  await expect(page.locator('#todo-editor textarea').first()).toHaveValue('닫기 직전의 업무');
  const bounds = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  // At fractional Windows display scaling, the OS may round the initial size.
  // Restore the actual saved rectangle, rather than the pre-rounding request.
  const tolerance = process.platform === 'win32' ? 2 : 0;
  expect(Math.abs(bounds.width - savedBounds.width)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(bounds.height - savedBounds.height)).toBeLessThanOrEqual(tolerance);
  await desktop.close(); desktop = null;
  const persistedAgain = JSON.parse(await readFile(path.join(directory, 'window-state.json'), 'utf8'));
  // The one-time OS rounding must never grow the saved window on each restart.
  expect(persistedAgain.width).toBe(savedBounds.width);
  expect(persistedAgain.height).toBe(savedBounds.height);
});
