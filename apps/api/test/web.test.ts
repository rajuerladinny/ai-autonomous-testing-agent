import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import type { INestApplication } from '@nestjs/common';
import type { Database } from '../src/db.js';
import { createApp } from '../dist/app.js';
import { AgentService } from '../dist/service.js';
import { SafeBrowser } from '../dist/browser.js';
import { TestGenerator } from '../dist/generator.js';
import { testDatabase } from './helpers.js';

describe('full React → NestJS → PostgreSQL → Playwright workflow', () => {
  let browser: Browser,
    db: Database,
    app: INestApplication,
    vite: ViteDevServer,
    service: AgentService,
    origin: string;
  const token = 'local-ui-test-only-'.repeat(4);
  beforeAll(async () => {
    db = await testDatabase();
    const target = new SafeBrowser(async () => ({
      status: 200,
      body: Buffer.from('<!doctype html><title>Demo portal</title><h1>Welcome to the portal</h1>'),
      headers: { 'content-type': 'text/html' },
    }));
    service = new AgentService(db, new TestGenerator(), target, async () => {});
    app = await createApp(service, { adminToken: token, webOrigin: 'http://127.0.0.1:5173' });
    await app.listen(0, '127.0.0.1');
    vite = await createServer({
      configFile: false,
      root: fileURLToPath(new URL('../../web', import.meta.url)),
      plugins: [react()],
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': await app.getUrl() } },
    });
    await vite.listen();
    const address = vite.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server');
    origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      chromiumSandbox: process.env.CHROMIUM_SANDBOX !== 'false',
    });
  });
  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    await app?.close();
    await db?.close();
  });
  it('lets a human review, approve, execute and inspect an actual report', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin);
    await page.getByLabel('Workspace admin token').fill(token);
    await page.getByRole('button', { name: 'Unlock workspace' }).click();
    await page.getByLabel('Project name').fill('Customer portal');
    await page.getByLabel('Application origin').fill('https://example.com');
    await page.getByLabel('I own this environment or have permission to test it.').check();
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.getByRole('button', { name: 'Start discovery' }).click();
    await page.waitForFunction(() => document.body.textContent?.includes('QUEUED'));
    expect(await service.processNext()).toBe(true);
    await page.getByRole('button', { name: 'Generate drafts' }).click();
    await page.getByRole('button', { name: 'Approve test' }).waitFor();
    expect(await page.getByRole('button', { name: 'Run selected (0)' }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Approve test' }).click();
    await page.getByRole('checkbox', { name: 'Select Check /' }).check();
    if (process.env.CAPTURE_UI_SCREENSHOT) {
      await mkdir('artifacts', { recursive: true });
      await page.screenshot({ path: 'artifacts/workspace.png', fullPage: true });
    }
    await page.getByRole('button', { name: 'Run selected (1)' }).click();
    await page.waitForFunction(() => document.body.textContent?.includes('QUEUED'));
    expect(await service.processNext()).toBe(true);
    await page.getByText('1 passed · 0 failed', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'View run report' }).click();
    await page.getByRole('heading', { name: 'Run details' }).waitFor();
    expect(await page.getByRole('button', { name: 'Export JSON' }).isVisible()).toBe(true);
    await page.waitForTimeout(200);
    expect(await page.getByRole('heading', { name: 'Run details' }).isVisible()).toBe(true);
    const storage = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));
    expect(JSON.stringify(storage)).not.toContain(token);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole('button', { name: 'Activity log' }).click();
    await page.getByRole('heading', { name: 'Workspace activity' }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  });
});
