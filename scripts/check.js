import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const files = ['playwright.config.js'];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(file);
    else if (/\.(c?js)$/.test(entry.name)) files.push(file);
  }
}
for (const directory of ['electron', 'shared', 'src', 'scripts', 'tests']) collect(directory);
for (const file of files) {
  const check = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (check.status) process.exit(check.status);
}
console.log(`${files.length}개 JavaScript 파일의 구문 검사 통과`);
