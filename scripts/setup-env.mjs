import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const password = randomBytes(24).toString('hex');
const env = `DATABASE_URL=postgres://agent:${password}@127.0.0.1:5432/agent\nADMIN_TOKEN=${randomBytes(32).toString('hex')}\nPOSTGRES_PASSWORD=${password}\nPORT=3001\nWEB_ORIGIN=http://127.0.0.1:5173\nOPENAI_API_KEY=\nOPENAI_MODEL=\n`;
try {
  writeFileSync(new URL('../.env', import.meta.url), env, { flag: 'wx', mode: 0o600 });
  console.log('Created .env with fresh local credentials. Existing files are never overwritten.');
} catch (e) {
  if (e.code === 'EEXIST') console.log('.env already exists; left unchanged.');
  else throw e;
}
