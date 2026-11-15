import type {
  CaseResult,
  Discovery,
  JobStatus,
  PageSnapshot,
  Project,
  Report,
  Run,
  TestCase,
  TestSpec,
} from '@agent/contracts';
import type { Backend, Config, EventRow } from './api';

/**
 * An in-browser stand-in for the API, used by the public demo.
 *
 * It keeps everything in memory, makes no network requests and follows the same
 * rules the real service enforces: one active job per project, digest-bound
 * approvals and runs limited to approved tests. Jobs finish on a timer so the
 * queued → running → finished flow is visible.
 */

const QUEUE_MS = 900;
const WORK_MS = 2200;
const HOUR = 3600000;

const CATALOGUE: PageSnapshot[] = [
  {
    path: '/',
    title: 'Acme Docs · Home',
    headings: ['Welcome to Acme Docs', 'Popular guides'],
    links: ['/docs', '/pricing', '/help', '/status'],
  },
  {
    path: '/docs',
    title: 'Documentation',
    headings: ['Getting started', 'API reference'],
    links: ['/', '/help'],
  },
  {
    path: '/pricing',
    title: 'Pricing',
    headings: ['Simple, predictable pricing'],
    links: ['/'],
  },
  { path: '/help', title: 'Help centre', headings: ['How can we help?'], links: ['/', '/docs'] },
  {
    path: '/status',
    title: 'System status',
    headings: ['All systems operational'],
    links: ['/'],
  },
];
/** The demo target "changes" this page after discovery, so one test can fail. */
const DRIFTED_PATH = '/status';

type Job = { kind: 'DISCOVER' | 'RUN'; id: string; at: number; testIds: string[] };

function hex(text: string, seed: number) {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
/** A stable 64-character stand-in for the SHA-256 approval digest. */
export function demoDigest(spec: TestSpec, discoveryId: string) {
  const text = JSON.stringify(spec) + discoveryId;
  return Array.from({ length: 8 }, (_, i) => hex(text, i)).join('');
}
function allowed(path: string, prefixes: string[]) {
  return prefixes.some((p) => p === '/' || path === p || path.startsWith(`${p}/`));
}
function fail(message: string): never {
  throw new Error(message);
}

export function createDemoBackend(clock: () => number = Date.now): Backend {
  let counter = 0;
  const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  const iso = (offset = 0) => new Date(clock() + offset).toISOString();

  const projects: Project[] = [];
  const discoveries: Discovery[] = [];
  const tests: TestCase[] = [];
  const runs: Run[] = [];
  const events: (EventRow & { project_id: string })[] = [];
  let jobs: Job[] = [];

  const log = (projectId: string, action: string, offset = 0) =>
    events.unshift({ id: id(), action, created_at: iso(offset), project_id: projectId });
  const project = (projectId: string) =>
    projects.find((p) => p.id === projectId) ?? fail('Project not found');

  function pagesFor(p: Project) {
    const pages = CATALOGUE.filter((page) => allowed(page.path, p.paths)).slice(0, p.maxPages);
    return pages.length
      ? pages
      : [{ path: p.paths[0], title: p.name, headings: [`Welcome to ${p.name}`], links: [] }];
  }
  function drafts(d: Discovery, offset = 0) {
    let created = 0;
    for (const page of d.pages) {
      const spec: TestSpec = {
        title: `Check ${page.path}`,
        path: page.path,
        assertions: [
          { kind: 'title', expected: page.title },
          ...(page.headings[0] ? [{ kind: 'heading' as const, expected: page.headings[0] }] : []),
        ],
      };
      const digest = demoDigest(spec, d.id);
      if (tests.some((t) => t.digest === digest)) continue;
      tests.unshift({
        id: id(),
        project_id: d.project_id,
        discovery_id: d.id,
        spec,
        digest,
        status: 'DRAFT',
        source: 'deterministic',
        approved_at: null,
        created_at: iso(offset),
      });
      created++;
    }
    return created;
  }
  function execute(testIds: string[]): CaseResult[] {
    return testIds.map((testId): CaseResult => {
      const t = tests.find((x) => x.id === testId)!;
      const drifted = t.spec.path === DRIFTED_PATH;
      const assertions = t.spec.assertions.map((a) => ({
        kind: a.kind,
        passed: !(drifted && a.kind === 'heading'),
      }));
      const passed = assertions.every((a) => a.passed);
      return {
        testId,
        title: t.spec.title,
        status: passed ? 'PASSED' : 'FAILED',
        durationMs: 120 + (parseInt(hex(testId, 7), 16) % 400),
        assertions,
        ...(passed ? {} : { error: 'Expected heading was not found on the page' }),
      };
    });
  }
  /** Moves timed jobs forward; called before every request. */
  function settle() {
    const now = clock();
    jobs = jobs.filter((job) => {
      const elapsed = now - job.at;
      const status: JobStatus =
        elapsed < QUEUE_MS ? 'QUEUED' : elapsed < QUEUE_MS + WORK_MS ? 'RUNNING' : 'SUCCEEDED';
      if (job.kind === 'DISCOVER') {
        const d = discoveries.find((x) => x.id === job.id)!;
        d.status = status;
        if (status !== 'SUCCEEDED') return true;
        d.pages = pagesFor(project(d.project_id));
        d.blocked = 3;
        log(d.project_id, 'DISCOVERY_COMPLETED');
        return false;
      }
      const r = runs.find((x) => x.id === job.id)!;
      r.status = status;
      if (status !== 'SUCCEEDED') return true;
      r.results = execute(job.testIds);
      r.finished_at = iso();
      log(r.project_id, 'RUN_COMPLETED');
      return false;
    });
  }
  const active = (projectId: string, kind: Job['kind']) =>
    jobs.some(
      (j) =>
        j.kind === kind &&
        (kind === 'DISCOVER' ? discoveries : runs).some(
          (x) => x.id === j.id && x.project_id === projectId,
        ),
    );

  function createProject(body: unknown, offset = 0) {
    const input = (body ?? {}) as Partial<Project>;
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 80) fail('Enter a project name of up to 80 characters');
    let origin: URL;
    try {
      origin = new URL(String(input.baseUrl ?? ''));
    } catch {
      fail('Enter a valid application origin');
    }
    if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.port)
      fail('Use an https origin without a path, port or query');
    const paths = Array.isArray(input.paths) ? input.paths.map(String) : [];
    if (!paths.length || paths.length > 20 || paths.some((p) => !p.startsWith('/')))
      fail('Path prefixes must start with /');
    const maxPages = Number(input.maxPages ?? 5);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20)
      fail('Maximum pages must be between 1 and 20');
    if (input.ownershipConfirmed !== true) fail('Confirm that you may test this environment');
    const created: Project = {
      id: id(),
      name,
      baseUrl: origin.origin,
      paths,
      maxPages,
      ownershipConfirmed: true,
      created_at: iso(offset),
    };
    projects.unshift(created);
    log(created.id, 'PROJECT_CREATED', offset);
    return created;
  }
  function decide(testId: string, body: unknown) {
    const input = (body ?? {}) as { decision?: string; digest?: string };
    const t = tests.find((x) => x.id === testId) ?? fail('Test not found');
    const decision =
      input.decision === 'APPROVED' || input.decision === 'REJECTED'
        ? input.decision
        : fail('Invalid request');
    if (t.status !== 'DRAFT') fail('Only draft tests can be decided');
    if (input.digest !== t.digest) fail('The specification changed; review it again');
    t.status = decision;
    t.approved_at = decision === 'APPROVED' ? iso() : null;
    log(t.project_id, `TEST_${decision}`);
    return t;
  }
  function createRun(projectId: string, body: unknown) {
    project(projectId);
    const testIds = ((body ?? {}) as { testIds?: unknown }).testIds;
    if (!Array.isArray(testIds) || !testIds.length || testIds.length > 20)
      fail('Select between 1 and 20 approved tests');
    if (active(projectId, 'RUN')) fail('A run is already in progress for this project');
    const chosen = testIds.map((t) => tests.find((x) => x.id === t && x.project_id === projectId));
    if (chosen.some((t) => !t || t.status !== 'APPROVED')) fail('Only approved tests can run');
    const run: Run = {
      id: id(),
      project_id: projectId,
      status: 'QUEUED',
      results: [],
      error: null,
      created_at: iso(),
      finished_at: null,
    };
    runs.unshift(run);
    jobs.push({ kind: 'RUN', id: run.id, at: clock(), testIds: testIds.map(String) });
    log(projectId, 'RUN_QUEUED');
    return { id: run.id, status: run.status };
  }
  function report(runId: string): Report {
    const run = runs.find((r) => r.id === runId) ?? fail('Run not found');
    return {
      ...run,
      summary: {
        total: run.results.length,
        passed: run.results.filter((r) => r.status === 'PASSED').length,
        failed: run.results.filter((r) => r.status === 'FAILED').length,
      },
      approvals: run.results.map((r) => ({
        testId: r.testId,
        digest: tests.find((t) => t.id === r.testId)?.digest ?? '',
      })),
    };
  }

  function route(path: string, body: unknown): unknown {
    const read = body === undefined;
    let m: RegExpMatchArray | null;
    if (path === '/config' && read) {
      const config: Config = { aiEnabled: false, mode: 'read-only', maxTestsPerRun: 20 };
      return config;
    }
    if (path === '/projects') return read ? projects : createProject(body);
    if ((m = path.match(/^\/projects\/([^/]+)\/discoveries$/))) {
      const projectId = m[1];
      if (read) return discoveries.filter((d) => d.project_id === projectId);
      project(projectId);
      if (active(projectId, 'DISCOVER')) fail('A discovery is already in progress');
      const d: Discovery = {
        id: id(),
        project_id: projectId,
        status: 'QUEUED',
        pages: [],
        blocked: 0,
        error: null,
        created_at: iso(),
      };
      discoveries.unshift(d);
      jobs.push({ kind: 'DISCOVER', id: d.id, at: clock(), testIds: [] });
      log(projectId, 'DISCOVERY_QUEUED');
      return { id: d.id, status: d.status };
    }
    if ((m = path.match(/^\/discoveries\/([^/]+)\/generate$/)) && !read) {
      const d = discoveries.find((x) => x.id === m![1]) ?? fail('Discovery not found');
      if (d.status !== 'SUCCEEDED') fail('Discovery has not completed');
      const created = drafts(d);
      log(d.project_id, 'TESTS_GENERATED');
      return { created, source: 'deterministic' };
    }
    if ((m = path.match(/^\/projects\/([^/]+)\/tests$/)) && read)
      return tests.filter((t) => t.project_id === m![1]);
    if ((m = path.match(/^\/tests\/([^/]+)\/decision$/)) && !read) return decide(m[1], body);
    if ((m = path.match(/^\/projects\/([^/]+)\/runs$/)))
      return read ? runs.filter((r) => r.project_id === m![1]) : createRun(m[1], body);
    if ((m = path.match(/^\/runs\/([^/]+)\/report$/)) && read) return report(m[1]);
    if ((m = path.match(/^\/projects\/([^/]+)\/events$/)) && read)
      return events
        .filter((e) => e.project_id === m![1])
        .slice(0, 100)
        .map(({ id: eventId, action, created_at }) => ({ id: eventId, action, created_at }));
    return fail('Not found');
  }

  // Seed a project with history so the workspace is not empty on first view.
  const seed = createProject(
    {
      name: 'Acme docs portal',
      baseUrl: 'https://staging.acme.example',
      paths: ['/'],
      maxPages: 5,
      ownershipConfirmed: true,
    },
    -50 * HOUR,
  );
  const seeded: Discovery = {
    id: id(),
    project_id: seed.id,
    status: 'SUCCEEDED',
    pages: pagesFor(seed),
    blocked: 3,
    error: null,
    created_at: iso(-49 * HOUR),
  };
  discoveries.unshift(seeded);
  log(seed.id, 'DISCOVERY_COMPLETED', -49 * HOUR);
  drafts(seeded, -48 * HOUR);
  log(seed.id, 'TESTS_GENERATED', -48 * HOUR);
  const byPath = (p: string) => tests.find((t) => t.spec.path === p)!;
  for (const p of ['/', '/docs', '/status']) {
    const t = byPath(p);
    t.status = 'APPROVED';
    t.approved_at = iso(-47 * HOUR);
    log(seed.id, 'TEST_APPROVED', -47 * HOUR);
  }
  for (const [offset, paths] of [
    [-26 * HOUR, ['/', '/docs']],
    [-3 * HOUR, ['/', '/docs', '/status']],
  ] as const) {
    runs.unshift({
      id: id(),
      project_id: seed.id,
      status: 'SUCCEEDED',
      results: execute(paths.map((p) => byPath(p).id)),
      error: null,
      created_at: iso(offset),
      finished_at: iso(offset + 4000),
    });
    log(seed.id, 'RUN_COMPLETED', offset + 4000);
  }

  return {
    async request<T>(path: string, body?: unknown): Promise<T> {
      settle();
      // Clone so the UI can never mutate demo state by reference.
      return JSON.parse(JSON.stringify(route(path, body))) as T;
    },
  };
}
