// Builds the static, in-browser demo of the workspace into apps/web/dist.
import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  VITE_DEMO_MODE: 'true',
  VITE_BASE: process.env.VITE_BASE ?? './',
};
for (const workspace of ['@agent/contracts', '@agent/web']) {
  const result = spawnSync('npm', ['run', 'build', '-w', workspace], {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
