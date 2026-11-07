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
