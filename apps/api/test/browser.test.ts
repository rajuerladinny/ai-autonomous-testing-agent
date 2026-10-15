import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SafeBrowser, type FetchDocument } from '../src/browser.js';
import { digest } from '../src/safety.js';
import type { Project, TestCase } from '@agent/contracts';
const project: Project = {
  id: randomUUID(),
  name: 'Fixture',
  baseUrl: 'https://example.com',
  paths: ['/docs'],
  maxPages: 3,
  ownershipConfirmed: true,
  created_at: new Date().toISOString(),
};
const html = (title = 'Docs') =>
  `<!doctype html><html><head><title>${title}</title></head><body><h1>Welcome</h1><a href="/docs/intro">Intro</a><a href="/docs/delete">Delete</a><a href="https://evil.example/steal">External</a><a href="http://169.254.169.254/latest/meta-data/">Metadata</a><a href="/docs?token=secret">Query</a><form action="/docs/submit" method="post"><input name="private" value="secret"></form><script>fetch('/docs/submit',{method:'POST'});document.body.innerHTML='MUTATED';</script><img src="https://evil.example/pixel"/></body></html>`;
describe('real Chromium constrained discovery and execution', () => {
  it('reads only approved documents, blocks side effects and does not extract input values', async () => {
    const requests: string[] = [];
    const fetchDocument: FetchDocument = async (url) => {
      requests.push(url.href);
      return { status: 200, body: Buffer.from(html()), headers: { 'content-type': 'text/html' } };
    };
    const result = await new SafeBrowser(fetchDocument).discover(project);
    expect(result.pages.map((p) => p.path)).toEqual(['/docs', '/docs/intro']);
    expect(requests).toEqual(['https://example.com/docs', 'https://example.com/docs/intro']);
    expect(JSON.stringify(result.pages)).not.toContain('secret');
    expect(result.pages[0].headings).toEqual(['Welcome']);
    expect(result.blocked).toBeGreaterThan(0);
  });
  it('reports actual assertion failures when the page changes', async () => {
    const spec = {
      title: 'Title stays stable',
      path: '/docs',
      assertions: [{ kind: 'title' as const, expected: 'Docs' }],
    };
    const discoveryId = randomUUID();
    const test: TestCase = {
      id: randomUUID(),
      project_id: project.id,
      discovery_id: discoveryId,
      spec,
      digest: digest(spec, discoveryId),
      status: 'APPROVED',
      source: 'deterministic',
      approved_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    const browser = new SafeBrowser(async () => ({
      status: 200,
      body: Buffer.from(html('Changed')),
      headers: { 'content-type': 'text/html' },
    }));
    const results = await browser.execute(project, [test]);
    expect(results[0].status).toBe('FAILED');
    expect(results[0].assertions[0].passed).toBe(false);
  });
  it('does not follow an out-of-scope redirect', async () => {
    const seen: string[] = [];
    const browser = new SafeBrowser(async (url) => {
      seen.push(url.href);
      return {
        status: 302,
        body: Buffer.from(''),
        headers: { location: 'https://evil.example/steal' },
      };
    });
    await expect(browser.discover(project)).rejects.toThrow('No readable');
    expect(seen.every((u) => u.startsWith(project.baseUrl))).toBe(true);
  });
});
