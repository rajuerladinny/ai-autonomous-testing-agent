import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { Project, PageSnapshot, TestCase, CaseResult } from '@agent/contracts';
import { fetchPinned, scopedUrl, sanitizeText } from './safety.js';

export type FetchDocument = typeof fetchPinned;
export class SafeBrowser {
  constructor(private readonly fetchDocument: FetchDocument = fetchPinned) {}
  private async session<T>(
    project: Project,
    work: (context: BrowserContext, blocked: () => number) => Promise<T>,
  ): Promise<T> {
    const browser: Browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      chromiumSandbox: process.env.CHROMIUM_SANDBOX !== 'false',
      args: [
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--disable-extensions',
        '--no-first-run',
      ],
    });
    const deadline = setTimeout(() => void browser.close(), 180000);
    try {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        serviceWorkers: 'block',
        acceptDownloads: false,
        ignoreHTTPSErrors: false,
        viewport: { width: 1280, height: 800 },
      });
      let blocked = 0,
        requests = 0;
      await context.routeWebSocket('**/*', (ws) => {
        blocked++;
        ws.close();
      });
      await context.route('**/*', async (route) => {
        const req = route.request();
        try {
          if (
            ++requests > 60 ||
            req.method() !== 'GET' ||
            req.resourceType() !== 'document' ||
            !req.isNavigationRequest() ||
            req.frame().parentFrame() !== null
          )
            throw new Error('Blocked request');
          const url = scopedUrl(req.url(), project);
          const response = await this.fetchDocument(url, project);
          await route.fulfill({
            status: response.status,
            body: response.body,
            headers: response.headers,
          });
        } catch {
          blocked++;
          await route.abort('blockedbyclient').catch(() => {});
        }
      });
      return await work(context, () => blocked);
    } finally {
      clearTimeout(deadline);
      await browser.close();
    }
  }

  async discover(project: Project): Promise<{ pages: PageSnapshot[]; blocked: number }> {
    return this.session(project, async (context, blocked) => {
      const queue = [...project.paths],
        seen = new Set<string>(),
        pages: PageSnapshot[] = [];
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      while (queue.length && seen.size < project.maxPages) {
        const path = queue.shift()!;
        if (seen.has(path)) continue;
        seen.add(path);
        try {
          const response = await page.goto(scopedUrl(path, project).href, {
            waitUntil: 'domcontentloaded',
            timeout: 10000,
          });
          if (!response || response.status() >= 400) continue;
          const title = sanitizeText(await page.title());
          const headings = (await page.locator('h1,h2').allTextContents())
            .map(sanitizeText)
            .filter(Boolean)
            .slice(0, 15);
          const hrefs = await page
            .locator('a[href]')
            .evaluateAll((nodes) => nodes.slice(0, 100).map((n) => n.getAttribute('href') ?? ''));
          const links: string[] = [];
          for (const href of hrefs) {
            try {
              const u = scopedUrl(href, project, page.url());
              links.push(u.pathname);
              if (!seen.has(u.pathname)) queue.push(u.pathname);
            } catch {
              /* out of scope */
            }
          }
          pages.push({ path, title, headings, links: [...new Set(links)].slice(0, 30) });
        } catch {
          /* One blocked or unavailable page does not authorize broader crawling. */
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!pages.length)
        throw new Error(
          'No readable HTML pages found in scope. Check the final URL and server-rendered content.',
        );
      return { pages, blocked: blocked() };
    });
  }

  async execute(project: Project, tests: TestCase[]): Promise<CaseResult[]> {
    return this.session(project, async (context) => {
      const results: CaseResult[] = [];
      for (const test of tests) {
        const started = Date.now(),
          assertions: { kind: string; passed: boolean }[] = [];
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        try {
          const response = await page.goto(scopedUrl(test.spec.path, project).href, {
            waitUntil: 'domcontentloaded',
            timeout: 10000,
          });
          if (!response || response.status() >= 400) throw new Error('Page unavailable');
          for (const a of test.spec.assertions) {
            const passed =
              a.kind === 'title'
                ? sanitizeText(await page.title()) === a.expected
                : (await page.locator('h1,h2').allTextContents())
                    .map(sanitizeText)
                    .includes(a.expected);
            assertions.push({ kind: a.kind, passed });
          }
          results.push({
            testId: test.id,
            title: test.spec.title,
            status: assertions.every((a) => a.passed) ? 'PASSED' : 'FAILED',
            durationMs: Date.now() - started,
            assertions,
          });
        } catch {
          results.push({
            testId: test.id,
            title: test.spec.title,
            status: 'FAILED',
            durationMs: Date.now() - started,
            assertions,
            error: 'Page blocked, unavailable, or timed out',
          });
        } finally {
          await page.close();
        }
      }
      return results;
    });
  }
}
