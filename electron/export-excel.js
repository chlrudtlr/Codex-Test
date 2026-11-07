import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function createTodoWorkbook(rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Daynote';
  const sheet = workbook.addWorksheet('업무 정리', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: '날짜', key: 'date', width: 16 },
    { header: '업무 내용', key: 'content', width: 76 },
    { header: '상태', key: 'status', width: 12 }
  ];
  sheet.addRows(rows);
  sheet.eachRow((row, index) => {
    row.font = { name: '맑은 고딕', size: 11, bold: index === 1 };
    row.alignment = { vertical: 'top', wrapText: true };
    row.eachCell(cell => {
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
    });
    if (index === 1) {
      row.height = 26;
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    } else {
      const content = rows[index - 2].content;
      const lines = content.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil([...line].length / 36)), 0);
      row.height = Math.min(409, Math.max(26, lines * 17 + 8));
    }
  });
  sheet.autoFilter = { from: 'A1', to: `C${sheet.rowCount}` };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function writeTodoWorkbook(file, rows) {
  const buffer = await createTodoWorkbook(rows);
  const temporary = path.join(path.dirname(file), `.daynote-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close(); handle = undefined;
    await fs.rename(temporary, file);
  } finally {
    if (handle) await handle.close();
    await fs.rm(temporary, { force: true });
  }
}
