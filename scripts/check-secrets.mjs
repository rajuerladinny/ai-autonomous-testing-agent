import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const skip = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'artifacts',
  'playwright-report',
  'test-results',
]);
const violations = [];
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      scan(path);
      continue;
    }
    if (entry.name === '.env' || (entry.name.startsWith('.env.') && entry.name !== '.env.example'))
      continue;
    if (/\.(pem|key|p12)$/.test(entry.name)) {
      violations.push(relative(root, path));
      continue;
    }
    const text = readFileSync(path, 'utf8');
    if (
      /(?:sk-[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(
        text,
      )
    )
      violations.push(relative(root, path));
  }
}
scan(root);
if (violations.length) {
  console.error('Potential secrets detected in:', violations.join(', '));
  process.exitCode = 1;
} else console.log('No recognizable credentials or private keys found in source files.');
