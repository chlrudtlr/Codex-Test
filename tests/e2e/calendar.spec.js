import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, readFile, copyFile, stat } from 'node:fs/promises';
import ExcelJS from 'exceljs';
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
  await expect(page.locator('#todo-editor .task').first()).toHaveCSS('border-bottom-width', '0px');
  // A one-physical-pixel divider is 0.8 CSS pixels at Windows 125% scaling.
  const divider = await page.locator('#todo-editor .note').evaluate(row => parseFloat(getComputedStyle(row).borderBottomWidth));
  expect(divider).toBeGreaterThan(0);
  expect(divider).toBeLessThanOrEqual(1);
  expect(await page.locator('#todo-editor .note-mark').evaluate(mark => getComputedStyle(mark, '::before').borderRadius)).toBe('50%');
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

test('9가지 테마를 적용하고 기록과 테마를 재실행 후에도 보존한다', async () => {
  await page.locator('#todo-editor textarea').fill('테마 변경 후에도 남는 업무');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.locator('#theme-options input')).toHaveCount(9);
  const themes = [
    ['red', '빨강'], ['orange', '주황'], ['yellow', '노랑'], ['green', '초록'],
    ['blue', '파랑'], ['indigo', '남색'], ['violet', '보라'], ['light', '밝은 테마'], ['dark', '어두운 테마']
  ];
  for (const [id, label] of themes) {
    await page.getByRole('radio', { name: label, exact: true }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', id);
    await expect(page.locator('#theme-status')).toHaveText('테마가 저장되었습니다.');
    await expect(page.getByRole('radio', { name: label, exact: true })).toBeEnabled();
  }
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('.app-credit')).toContainText('Crafted by ks0108.choi');
  await expect(page.locator('.app-credit')).toBeInViewport();
  await page.screenshot({ path: `test-results/settings-dark-${process.platform}.png` });
  await page.getByRole('button', { name: '완료', exact: true }).click();
  await page.screenshot({ path: `test-results/calendar-dark-${process.platform}.png` });
  await expect(page.locator('#save-label')).toHaveText('자동 저장됨');
  await desktop.close(); desktop = null;
  await launch();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#todo-editor textarea').first()).toHaveValue('테마 변경 후에도 남는 업무');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByRole('radio', { name: '어두운 테마', exact: true })).toBeChecked();
  // Returning to a light colour theme also resets the native colour scheme.
  await page.getByRole('radio', { name: '파랑', exact: true }).check();
  await expect(page.locator('#theme-status')).toHaveText('테마가 저장되었습니다.');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.getByRole('button', { name: '완료', exact: true }).click();
  await page.locator('#todo-editor textarea').first().press('End');
  await page.locator('#todo-editor textarea').first().press('Enter');
  await page.locator('#todo-editor textarea').nth(1).press('Tab');
  await page.locator('#todo-editor .note textarea').fill('체크박스와 설명이 같은 구분선 안에 표시됩니다.');
  await page.screenshot({ path: `test-results/calendar-blue-${process.platform}.png` });
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

test('캘린더는 일정 표시로 시작하고 일정·할 일을 하나씩 전환한다', async () => {
  let scheduleButton = page.getByRole('button', { name: '일정만 표시', exact: true });
  let todoButton = page.getByRole('button', { name: '할일만 표시', exact: true });
  const controls = page.locator('.calendar-display-controls');
  let cell = page.locator('.day-cell.selected');
  const key = await cell.getAttribute('data-date');
  await expect(scheduleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(todoButton).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#schedule-editor textarea').fill('10:00 일정 회의');
  await page.locator('#todo-editor textarea').fill('할 일 보고서');
  await expect(cell.locator('.event-text')).toHaveText(['10:00 일정 회의']);
  await todoButton.click();
  await expect(controls.locator('[aria-pressed="true"]')).toHaveCount(1);
  await expect(scheduleButton).toHaveAttribute('aria-pressed', 'false');
  await expect(cell.locator('.event-text')).toHaveText(['할 일 보고서']);
  await expect(page.locator('#calendar-legend')).toHaveText('할 일');
  await todoButton.click();
  await expect(todoButton).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#todo-editor input[type=checkbox]').check();
  await expect(cell.locator('.event-check')).toHaveCount(1);
  await expect(cell.locator('.day-progress')).toHaveText('완료 1/전체 1');
  await page.locator('#todo-editor textarea').fill('수정한 할 일');
  await expect(cell.locator('.event-text')).toHaveText(['수정한 할 일']);
  // Notes and blank tasks do not appear in the calendar preview.
  await page.locator('#todo-editor textarea').press('End');
  await page.locator('#todo-editor textarea').press('Enter');
  await page.locator('#todo-editor textarea').last().press('Tab');
  await page.locator('#todo-editor .note textarea').fill('캘린더에서 제외할 설명');
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await expect(cell.locator('.event-text')).toHaveText(['수정한 할 일']);
  await page.getByRole('button', { name: '다음 달', exact: true }).click();
  await expect(todoButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.day-cell.selected .event-line')).toHaveCount(0);
  await page.locator('#todo-editor textarea').fill('다음 달 할 일');
  await expect(page.locator('.day-cell.selected .event-text')).toHaveText(['다음 달 할 일']);
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(cell).toHaveAttribute('data-date', key);
  await expect(cell.locator('.event-text')).toHaveText(['수정한 할 일']);
  // Keyboard activation is equivalent to clicking, including repeated activation.
  await scheduleButton.focus();
  await scheduleButton.press('Space');
  await scheduleButton.press('Enter');
  await expect(controls.locator('[aria-pressed="true"]')).toHaveCount(1);
  await expect(scheduleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(cell.locator('.event-text')).toHaveText(['10:00 일정 회의']);
  await expect(cell.locator('.day-progress')).toHaveText('완료 1/전체 1');
  await todoButton.click();
  await expect(page.locator('#save-label')).toHaveText('자동 저장됨');
  await desktop.close(); desktop = null;
  await launch();
  scheduleButton = page.getByRole('button', { name: '일정만 표시', exact: true });
  todoButton = page.getByRole('button', { name: '할일만 표시', exact: true });
  cell = page.locator('.day-cell.selected');
  await expect(scheduleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(cell.locator('.event-text')).toHaveText(['10:00 일정 회의']);
  await todoButton.click();
  await expect(cell.locator('.event-text')).toHaveText(['수정한 할 일']);
  await page.locator('#todo-editor .delete-item').first().click();
  await expect(cell.locator('.event-line')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('할 일 표시의 긴 제목·숨겨진 개수와 작은 창의 전환 버튼 배치', async () => {
  await page.getByRole('button', { name: '할일만 표시', exact: true }).click();
  await page.locator('#todo-editor textarea').fill('아주 긴 할 일 제목으로 캘린더 날짜 칸의 말줄임 표시를 확인하는 업무');
  for (let index = 0; index < 7; index++) {
    await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
    await page.locator('#todo-editor textarea').last().fill(`추가 할 일 ${index + 1}`);
  }
  const cell = page.locator('.day-cell.selected');
  await expect(cell.locator('.more-events')).toHaveText(/\+\d+개/);
  const count = await cell.locator('.event-line').count();
  await expect(cell.locator('.more-events')).toHaveText(`+${8 - count}개`);
  expect(count).toBeGreaterThan(0);
  expect(await cell.locator('.event-text').first().evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(cell.locator('.event-text').first()).toHaveCSS('text-overflow', 'ellipsis');
  for (const [width, height] of [[920, 640], [1240, 820], [1600, 1000]]) {
    await desktop.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    await expect(page.locator('#show-todo')).toBeInViewport();
    const controls = await page.locator('.calendar-display-controls').boundingBox();
    const panel = await page.locator('.calendar-panel').boundingBox();
    expect(controls.x + controls.width).toBeLessThanOrEqual(panel.x + panel.width);
    await expect(cell.locator('.day-progress')).toBeInViewport();
    expect(await page.evaluate(() => document.body.scrollHeight <= innerHeight)).toBe(true);
    await page.screenshot({ path: `test-results/calendar-todo-${width}-${process.platform}.png` });
  }
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('radio', { name: '어두운 테마', exact: true }).check();
  await expect(page.locator('#theme-status')).toHaveText('테마가 저장되었습니다.');
  await page.getByRole('button', { name: '완료', exact: true }).click();
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640));
  await page.screenshot({ path: `test-results/calendar-todo-dark-${process.platform}.png` });
  expect(errors).toEqual([]);
});

test('설명 변환·삭제와 IME 조합 중 Enter 처리', async () => {
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
  await expect(page.locator('#toast')).not.toBeVisible();
  await expect(fields.first()).toHaveValue('');
  await expect(page.getByRole('button', { name: /삭제 실행 취소/ })).toHaveCount(0);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#auto-launch')).toBeDisabled();
  await expect(page.locator('#data-path')).toContainText(directory);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('빈 공간 클릭은 입력을 시작하거나 추가하지 않고 Enter와 +로만 항목을 추가한다', async () => {
  for (const [section, label] of [['schedule', '일정'], ['todo', '할 일']]) {
    const editor = page.locator(`#${section}-editor`);
    const fields = editor.locator('textarea');
    const bounds = await editor.boundingBox();
    const blankPoint = { x: bounds.width / 2, y: bounds.height - 12 };
    await editor.click({ position: blankPoint });
    await expect(fields).toHaveCount(1);
    expect(await fields.first().evaluate(field => document.activeElement === field)).toBe(false);
    await fields.first().click();
    await expect(fields.first()).toBeFocused();
    await fields.first().fill(`${label} 첫 번째 항목`);
    await editor.click({ position: blankPoint });
    await expect(fields).toHaveCount(1);
    expect(await fields.first().evaluate(field => document.activeElement === field)).toBe(false);
    await fields.first().click();
    await fields.first().press('End');
    await fields.first().press('Enter');
    await expect(fields).toHaveCount(2);
    await fields.nth(1).fill(`${label} 두 번째 항목`);
    await page.getByRole('button', { name: `${label} 추가`, exact: true }).click();
    await expect(fields).toHaveCount(3);
    await page.getByRole('button', { name: `${label} 2 삭제`, exact: true }).click();
    await expect(fields).toHaveCount(2);
    await expect(page.locator('#toast')).not.toBeVisible();
    expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('TEXTAREA');
  }
  expect(errors).toEqual([]);
});

test('키보드로 삭제하면 이전 입력줄이나 추가 버튼으로 포커스를 옮긴다', async () => {
  for (const section of ['schedule', 'todo']) {
    const fields = page.locator(`#${section}-editor textarea`);
    const remove = page.locator(`#${section}-editor .delete-item`);
    await fields.first().fill('유지할 항목');
    await fields.first().press('End');
    await fields.first().press('Enter');
    await fields.last().fill('삭제할 항목');
    await remove.last().focus();
    await page.keyboard.press('Enter');
    await expect(fields).toHaveCount(1);
    await expect(fields.first()).toHaveValue('유지할 항목');
    await expect(fields.first()).toBeFocused();
    await remove.first().focus();
    await page.keyboard.press('Enter');
    await expect(fields.first()).toHaveValue('');
    await expect(page.locator(`#add-${section}`)).toBeFocused();
  }
  expect(errors).toEqual([]);
});

test('동봉한 Pretendard Variable Medium을 사용하고 월 제목 크기를 로고와 맞춘다', async () => {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('500 16px "Pretendard Variable"', '업무 일정 Daynote'))).toBe(true);
  expect(await page.evaluate(() => [...document.fonts].some(font => font.family.includes('Pretendard Variable') && font.status === 'loaded'))).toBe(true);
  for (const selector of ['.brand h1', '#month-heading', '#todo-editor textarea', '#today-button']) {
    await expect(page.locator(selector)).toHaveCSS('font-weight', '500');
    await expect(page.locator(selector)).toHaveCSS('font-family', /Pretendard Variable/);
  }
  const logoSize = await page.locator('.brand h1').evaluate(element => getComputedStyle(element).fontSize);
  await expect(page.locator('#month-heading')).toHaveCSS('font-size', logoSize);
  await page.locator('#schedule-editor textarea').fill('10:00 주간 회의');
  await page.locator('#todo-editor textarea').fill('보고서 검토');
  await page.locator('#todo-editor textarea').press('End');
  await page.locator('#todo-editor textarea').press('Enter');
  await page.locator('#todo-editor textarea').nth(1).press('Tab');
  await page.locator('#todo-editor .note textarea').fill('주요 변경 사항과 수치를 확인합니다.');
  await page.locator('#todo-editor').click({ position: { x: 100, y: 220 } });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('TEXTAREA');
  await page.screenshot({ path: `test-results/calendar-pretendard-${process.platform}.png` });
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

test('Export 위치·기간 검증·빈 기간과 밝은/어두운 팝업', async () => {
  const exportBounds = await page.locator('#export-button').boundingBox();
  const saveBounds = await page.locator('#save-status').boundingBox();
  expect(exportBounds.x + exportBounds.width).toBeLessThanOrEqual(saveBounds.x);
  await desktop.evaluate(({ dialog }) => {
    globalThis.exportDialogCalls = 0;
    dialog.showSaveDialog = async () => { globalThis.exportDialogCalls++; return { canceled: true, filePath: '' }; };
  });
  await page.locator('#export-button').click();
  await expect(page.locator('#export-description')).toContainText('TODO List');
  await page.locator('#export-start').fill('2026-11-09');
  await page.locator('#export-end').fill('2026-11-08');
  await page.locator('#confirm-export').click();
  await expect(page.locator('#export-status')).toContainText('종료일');
  await page.locator('#export-start').fill('2026-11-01');
  await page.locator('#confirm-export').click();
  await expect(page.locator('#export-status')).toContainText('할 일이 없습니다');
  expect(await desktop.evaluate(() => globalThis.exportDialogCalls)).toBe(0);
  await page.screenshot({ path: `test-results/export-light-${process.platform}.png` });
  await page.keyboard.press('Escape');
  await expect(page.locator('#export-dialog')).not.toBeVisible();
  await page.locator('#settings-button').click();
  await page.getByRole('radio', { name: '어두운 테마', exact: true }).check();
  await expect(page.locator('#theme-status')).toHaveText('테마가 저장되었습니다.');
  await page.locator('#settings-done').click();
  await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(920, 640); });
  await page.locator('#export-button').click();
  await expect(page.locator('#export-dialog')).toBeInViewport();
  await expect(page.locator('#confirm-export')).toBeInViewport();
  await page.screenshot({ path: `test-results/export-dark-${process.platform}.png` });
  await page.locator('#cancel-export').click();
  expect(errors).toEqual([]);
});

test('취소·저장 실패 후 다시 내보내고 실제 Excel의 내용과 상태를 확인한다', async () => {
  const key = await page.locator('.day-cell.selected').getAttribute('data-date');
  await page.locator('#todo-editor textarea').fill('완료한 업무');
  await page.locator('#todo-editor input[type=checkbox]').first().check();
  await page.locator('#todo-editor textarea').first().press('End');
  await page.locator('#todo-editor textarea').first().press('Enter');
  await page.locator('#todo-editor textarea').nth(1).press('Tab');
  await page.locator('#todo-editor .note textarea').fill('함께 내보낼 설명');
  await page.locator('#todo-editor .note textarea').press('End');
  await page.locator('#todo-editor .note textarea').press('Enter');
  await page.locator('#todo-editor textarea').last().fill('아직 진행 중인 업무');
  await page.locator('#schedule-editor textarea').fill('포함하지 않을 일정');
  await desktop.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }); });
  await page.locator('#export-button').click();
  await page.locator('#export-start').fill(key);
  await page.locator('#export-end').fill(key);
  await page.locator('#confirm-export').click();
  await expect(page.locator('#export-status')).toContainText('저장을 취소했습니다');
  await expect(page.locator('#confirm-export')).toBeEnabled();
  const failedPath = path.join(directory, '없는 폴더', '실패.xlsx');
  await desktop.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, failedPath);
  await page.locator('#confirm-export').click();
  await expect(page.locator('#export-status')).toContainText('파일을 저장하지 못했습니다');
  const destination = path.join(directory, '업무 내보내기.xlsx');
  await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, destination);
  // Submit immediately after an input event: the autosave timer has not fired.
  await page.evaluate(() => {
    const field = document.querySelector('#todo-editor .task:last-child textarea');
    field.value = '내보내기 직전 수정한 업무';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('export-form').requestSubmit();
  });
  await expect(page.locator('#export-dialog')).not.toBeVisible();
  await expect(page.locator('#toast-message')).toContainText('할 일 2개를 Excel 파일로 저장했습니다');
  expect((await stat(destination)).size).toBeGreaterThan(0);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(destination);
  const sheet = workbook.getWorksheet('업무 정리');
  expect(sheet.rowCount).toBe(3);
  expect(sheet.getRow(1).values.slice(1)).toEqual(['날짜', '업무 내용', '상태']);
  expect(sheet.getRow(2).values.slice(1)).toEqual([key, '완료한 업무\n• 함께 내보낼 설명', '완료']);
  expect(sheet.getRow(3).values.slice(1)).toEqual([key, '내보내기 직전 수정한 업무', '미완료']);
  await copyFile(destination, 'test-results/todo-export-sample.xlsx');
  expect(errors).toEqual([]);
});

test('전체 메모 추가·수정·삭제와 날짜 독립성, 즉시 종료 후 복원', async () => {
  await page.locator('#schedule-editor textarea').fill('메모와 함께 보존할 일정');
  await page.locator('#todo-editor textarea').fill('메모와 함께 보존할 업무');
  await page.locator('#notebook-button').click();
  await expect(page.locator('#notebook-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#schedule-card')).toBeHidden();
  await expect(page.locator('#todo-card')).toBeHidden();
  await expect(page.locator('#memo-empty')).toBeVisible();
  await page.getByRole('button', { name: '메모 추가', exact: true }).click();
  await expect(page.locator('#memo-title')).not.toBeFocused();
  await expect(page.locator('#memo-content')).not.toBeFocused();
  await page.locator('#memo-title').click();
  await expect(page.locator('#memo-title')).toBeFocused();
  await page.locator('#memo-title').fill('프로젝트 참고');
  await page.locator('#memo-content').fill('회의에서 확인할 내용\n두 번째 줄');
  await page.getByRole('button', { name: '목록으로', exact: true }).click();
  await expect(page.locator('#memo-list button')).toHaveText(['프로젝트 참고']);
  await page.getByRole('button', { name: '다음 달', exact: true }).click();
  await expect(page.locator('#notebook-panel')).toBeVisible();
  await expect(page.locator('#memo-list button')).toHaveText(['프로젝트 참고']);
  await page.locator('#memo-list button').click();
  await expect(page.locator('#memo-content')).toHaveValue('회의에서 확인할 내용\n두 번째 줄');
  await page.locator('#memo-title').fill('수정한 프로젝트 참고');
  await page.locator('#memo-content').fill('종료 직전의 최신 메모\n자동 저장 확인');
  await desktop.close(); desktop = null;
  await launch();
  await expect(page.locator('#notebook-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#schedule-editor textarea')).toHaveValue('메모와 함께 보존할 일정');
  await expect(page.locator('#todo-editor textarea')).toHaveValue('메모와 함께 보존할 업무');
  await page.locator('#notebook-button').click();
  await expect(page.locator('#memo-list button')).toHaveText(['수정한 프로젝트 참고']);
  await page.locator('#memo-list button').click();
  await expect(page.locator('#memo-content')).toHaveValue('종료 직전의 최신 메모\n자동 저장 확인');
  await expect(page.locator('#memo-title')).not.toBeFocused();
  await expect(page.locator('#memo-content')).not.toBeFocused();
  await page.locator('#select-memos').click();
  await expect(page.locator('#memo-edit-view')).toBeHidden();
  await page.getByRole('checkbox', { name: '수정한 프로젝트 참고', exact: true }).check();
  await page.locator('#delete-selected-memos').click();
  await page.locator('#cancel-delete-memo').click();
  await expect(page.getByRole('checkbox', { name: '수정한 프로젝트 참고', exact: true })).toBeChecked();
  await page.locator('#delete-selected-memos').click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('checkbox', { name: '수정한 프로젝트 참고', exact: true })).toBeChecked();
  await page.locator('#delete-selected-memos').click();
  await page.locator('#confirm-delete-memo').click();
  await expect(page.locator('#memo-empty')).toBeVisible();
  await expect(page.locator('#add-memo')).toBeFocused();
  await page.locator('#add-memo').press('Enter');
  await page.locator('#memo-content').fill('제목이 없는 메모도 보존');
  await page.locator('#back-to-memos').click();
  await expect(page.locator('#memo-list button')).toHaveText(['제목 없음']);
  await page.locator('#notebook-button').click();
  await page.locator('#notebook-button').click();
  await page.locator('#memo-list button').click();
  await expect(page.locator('#memo-content')).toHaveValue('제목이 없는 메모도 보존');
  await expect(page.locator('#save-label')).toHaveText('자동 저장됨');
  const saved = JSON.parse(await readFile(path.join(directory, 'calendar.json'), 'utf8'));
  expect(saved.memos).toHaveLength(1);
  expect(saved.memos[0].content).toBe('제목이 없는 메모도 보존');
  expect(errors).toEqual([]);
});

test('메모장의 긴 제목·본문, 작은 창·큰 창 및 어두운 테마', async () => {
  await page.locator('#notebook-button').click();
  await page.locator('#add-memo').click();
  const title = '줄바꿈없이길게작성한메모제목'.repeat(12);
  const content = '긴 메모 본문과 한국어 입력을 확인합니다.\n'.repeat(80);
  await page.locator('#memo-title').fill(title);
  await page.locator('#memo-content').fill(content);
  await page.locator('#back-to-memos').click();
  for (const [width, height] of [[920, 640], [1240, 820], [1600, 1000]]) {
    await desktop.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    await expect(page.locator('#notebook-button')).toBeInViewport();
    await expect(page.locator('#memo-list button')).toHaveText(title);
    expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth && document.body.scrollHeight <= innerHeight)).toBe(true);
    const bounds = await page.locator('.selected-header').boundingBox();
    const button = await page.locator('#notebook-button').boundingBox();
    expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    await page.screenshot({ path: `test-results/notebook-list-${width}-${process.platform}.png` });
    await page.locator('#memo-list button').click();
    await expect(page.locator('#memo-content')).toHaveValue(content);
    await expect(page.locator('#memo-content')).toBeInViewport();
    await page.screenshot({ path: `test-results/notebook-edit-${width}-${process.platform}.png` });
    await page.locator('#back-to-memos').click();
  }
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('radio', { name: '어두운 테마', exact: true }).check();
  await expect(page.locator('#theme-status')).toHaveText('테마가 저장되었습니다.');
  await page.getByRole('button', { name: '완료', exact: true }).click();
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640));
  await page.locator('#memo-list button').click();
  await page.screenshot({ path: `test-results/notebook-dark-${process.platform}.png` });
  await page.locator('#back-to-day').click();
  await expect(page.locator('#notebook-button')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#todo-editor textarea').fill('카드 복귀 후에도 정상 편집');
  await expect(page.locator('#todo-editor textarea')).toHaveValue('카드 복귀 후에도 정상 편집');
  expect(errors).toEqual([]);
});

test('메모 복수 선택 삭제·취소·뒤로가기와 입력 전 커서 비활성', async () => {
  await page.locator('#notebook-button').click();
  await expect(page.locator('#select-memos')).toBeDisabled();
  await expect(page.locator('#notebook-panel')).not.toContainText('날짜와 관계없이 모든 메모를 모아둡니다.');
  for (const title of ['남길 메모', '삭제할 메모 A', '삭제할 메모 B']) {
    await page.locator('#add-memo').click();
    await expect(page.locator('#memo-title')).not.toBeFocused();
    await expect(page.locator('#memo-content')).not.toBeFocused();
    await page.locator('#memo-title').fill(title);
    await page.locator('#memo-content').fill(`${title} 본문`);
    await page.locator('#back-to-memos').click();
  }
  await page.getByRole('button', { name: '남길 메모', exact: true }).click();
  await expect(page.locator('#memo-title')).not.toBeFocused();
  await expect(page.locator('#memo-content')).not.toBeFocused();
  await page.keyboard.type('unintended');
  await expect(page.locator('#memo-title')).toHaveValue('남길 메모');
  await expect(page.locator('#memo-content')).toHaveValue('남길 메모 본문');
  await page.locator('#memo-content').click();
  await expect(page.locator('#memo-content')).toBeFocused();
  await page.locator('#select-memos').click();
  await expect(page.locator('#select-memos')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#add-memo')).toBeDisabled();
  await expect(page.locator('#delete-selected-memos')).toBeDisabled();
  await page.getByRole('checkbox', { name: '삭제할 메모 A', exact: true }).check();
  await page.getByRole('checkbox', { name: '삭제할 메모 B', exact: true }).check();
  await expect(page.locator('#memo-selection-count')).toHaveText('2개 선택');
  await page.getByRole('checkbox', { name: '삭제할 메모 B', exact: true }).uncheck();
  await expect(page.locator('#memo-selection-count')).toHaveText('1개 선택');
  await page.getByRole('checkbox', { name: '삭제할 메모 B', exact: true }).check();
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640));
  await expect(page.locator('#delete-selected-memos')).toBeInViewport();
  await page.screenshot({ path: `test-results/notebook-select-${process.platform}.png` });
  await page.locator('#delete-selected-memos').click();
  await expect(page.locator('#delete-memo-heading')).toHaveText('메모 2개를 삭제할까요?');
  await page.locator('#cancel-delete-memo').click();
  await expect(page.locator('#memo-list input:checked')).toHaveCount(2);
  await page.locator('#cancel-memo-selection').click();
  await expect(page.locator('#memo-list button')).toHaveCount(3);
  await page.locator('#select-memos').click();
  await expect(page.locator('#memo-list input:checked')).toHaveCount(0);
  await page.getByRole('checkbox', { name: '삭제할 메모 A', exact: true }).check();
  await page.getByRole('checkbox', { name: '삭제할 메모 B', exact: true }).check();
  await page.locator('#delete-selected-memos').click();
  await page.locator('#confirm-delete-memo').click();
  await expect(page.locator('#memo-list button')).toHaveText(['남길 메모']);
  await page.locator('#select-memos').click();
  await page.getByRole('checkbox', { name: '남길 메모', exact: true }).check();
  await page.locator('#back-to-day').click();
  await expect(page.locator('#notebook-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#schedule-card')).toBeVisible();
  await expect(page.locator('#todo-card')).toBeVisible();
  for (const section of ['schedule', 'todo']) {
    await expect(page.locator(`#${section}-editor input[type=checkbox]`)).toHaveCSS('width', '16px');
    await expect(page.locator(`#${section}-editor input[type=checkbox]`)).toHaveCSS('height', '16px');
  }
  await page.locator('#notebook-button').click();
  await expect(page.locator('#select-memos')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#memo-list button')).toHaveText(['남길 메모']);
  await page.locator('#memo-list button').click();
  await expect(page.locator('#memo-content')).toHaveValue('남길 메모 본문');
  await page.locator('#back-to-day').click();
  await expect(page.locator('#notebook-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#notebook-button')).toBeFocused();
  await expect(page.locator('#save-label')).toHaveText('자동 저장됨');
  await desktop.close(); desktop = null;
  await launch();
  await page.locator('#notebook-button').click();
  await expect(page.locator('#memo-list button')).toHaveText(['남길 메모']);
  expect(errors).toEqual([]);
});

test('문장 중간의 한글 조합 확정 Enter는 항목·커서를 유지하고 다음 Enter는 새 항목을 만든다', async () => {
  for (const section of ['schedule', 'todo']) {
    const fields = page.locator(`#${section}-editor textarea`);
    await fields.first().fill('회의 준비');
    await fields.first().focus();
    const result = await fields.first().evaluate(field => {
      field.setSelectionRange(3, 3);
      field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      field.setRangeText('자료 ', 3, 3, 'end');
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '자료 ', isComposing: true }));
      // Some IMEs end composition before delivering the confirming keydown.
      field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '자료 ' }));
      const caret = field.selectionStart;
      const confirmingEnter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
      field.dispatchEvent(confirmingEnter);
      const heldEnter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true, bubbles: true, cancelable: true });
      field.dispatchEvent(heldEnter);
      field.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      return { prevented: confirmingEnter.defaultPrevented, repeatPrevented: heldEnter.defaultPrevented, caret };
    });
    expect(result.prevented).toBe(true);
    expect(result.repeatPrevented).toBe(true);
    await expect(fields).toHaveCount(1);
    await expect(fields.first()).toHaveValue('회의 자료 준비');
    await expect(fields.first()).toBeFocused();
    expect(await fields.first().evaluate(field => field.selectionStart)).toBe(result.caret);
    // Track composition even when a confirming event incorrectly says false.
    await fields.first().evaluate(field => {
      field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      field.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    });
    await expect(fields).toHaveCount(1);
    await fields.first().press('End');
    await fields.first().press('Enter');
    await expect(fields).toHaveCount(2);
    await expect(fields.first()).toHaveValue('회의 자료 준비');
    await expect(fields.last()).toHaveValue('');
    await expect(fields.last()).toBeFocused();
  }
  expect(errors).toEqual([]);
});
