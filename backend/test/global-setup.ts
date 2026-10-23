import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TEST_DB_PATH } from './env';

/** Fresh SQLite database with every migration applied, shared by the (in-band) test files. */
export default function globalSetup() {
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
  fs.rmSync(TEST_DB_PATH, { force: true });
  execFileSync(path.join(__dirname, '..', 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_PATH}` },
    stdio: 'pipe',
  });
}
