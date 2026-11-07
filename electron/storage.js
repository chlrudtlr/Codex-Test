import fs from 'node:fs';
import path from 'node:path';
import { validateData } from '../shared/model.js';

export function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  const handle = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(handle, JSON.stringify(data, null, 2), 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temporary, file);
}

export class DataStore {
  constructor(directory) {
    this.file = path.join(directory, 'calendar.json');
    this.backup = `${this.file}.bak`;
    this.data = { version: 1, days: {} };
    this.loaded = false;
    this.recoveryMessage = '';
  }

  load() {
    if (this.loaded) return this.data;
    if (fs.existsSync(this.file)) {
      try {
        this.data = validateData(JSON.parse(fs.readFileSync(this.file, 'utf8')));
      } catch {
        // Preserve the damaged file before allowing any subsequent saves.
        fs.copyFileSync(this.file, `${this.file}.damaged-${Date.now()}`);
        if (!fs.existsSync(this.backup)) throw new Error('저장 파일을 읽을 수 없습니다. 원본을 보존했습니다.');
        this.data = validateData(JSON.parse(fs.readFileSync(this.backup, 'utf8')));
        atomicWrite(this.file, this.data);
        this.recoveryMessage = '저장 파일을 읽지 못해 이전 자동 백업을 복원했습니다. 손상된 원본도 보존했습니다.';
      }
    }
    this.loaded = true;
    return this.data;
  }

  save(data) {
    this.load();
    const validated = validateData(data);
    // Back up the last known valid state, rather than overwriting it with an
    // unvalidated payload or a partially written file.
    atomicWrite(this.backup, this.data);
    atomicWrite(this.file, validated);
    this.data = validated;
  }
}
