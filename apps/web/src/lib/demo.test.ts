import { describe, expect, it } from 'vitest';
import type { Discovery, Project, Report, Run, TestCase } from '@agent/contracts';
import { createDemoBackend, demoDigest } from './demo';

function setup() {
  let now = Date.parse('2026-06-01T10:00:00Z');
  const backend = createDemoBackend(() => now);
  return { backend, advance: (ms: number) => (now += ms) };
}

describe('demo backend', () => {
  it('starts with a seeded project, tests in mixed states and run history', async () => {
    const { backend } = setup();
    const [project] = await backend.request<Project[]>('/projects');
    expect(project.name).toBe('Acme docs portal');
    const tests = await backend.request<TestCase[]>(`/projects/${project.id}/tests`);
    expect(tests.map((t) => t.status).sort()).toEqual([
      'APPROVED',
      'APPROVED',
      'APPROVED',
      'DRAFT',
      'DRAFT',
    ]);
    expect(tests.every((t) => /^[a-f0-9]{64}$/.test(t.digest))).toBe(true);
    const runs = await backend.request<Run[]>(`/projects/${project.id}/runs`);
    expect(runs).toHaveLength(2);
    expect(runs[0].results.some((r) => r.status === 'FAILED')).toBe(true);
  });

  it('moves a discovery through queued, running and succeeded', async () => {
    const { backend, advance } = setup();
    const project = await backend.request<Project>('/projects', {
      name: 'Shop',
      baseUrl: 'https://staging.shop.example',
      paths: ['/docs'],
      maxPages: 3,
      ownershipConfirmed: true,
    });
    const path = `/projects/${project.id}/discoveries`;
    await backend.request(path, {});
    await expect(backend.request(path, {})).rejects.toThrow('already in progress');
    expect((await backend.request<Discovery[]>(path))[0].status).toBe('QUEUED');
    advance(1000);
    expect((await backend.request<Discovery[]>(path))[0].status).toBe('RUNNING');
    advance(3000);
    const [done] = await backend.request<Discovery[]>(path);
    expect(done.status).toBe('SUCCEEDED');
    expect(done.pages.map((p) => p.path)).toEqual(['/docs']);
  });

  it('binds approval to the digest and runs only approved tests', async () => {
    const { backend, advance } = setup();
    const [project] = await backend.request<Project[]>('/projects');
    const tests = await backend.request<TestCase[]>(`/projects/${project.id}/tests`);
    const draft = tests.find((t) => t.status === 'DRAFT')!;
    expect(draft.digest).toBe(demoDigest(draft.spec, draft.discovery_id));
    await expect(
      backend.request(`/projects/${project.id}/runs`, { testIds: [draft.id] }),
    ).rejects.toThrow('Only approved tests can run');
    await expect(
      backend.request(`/tests/${draft.id}/decision`, {
        decision: 'APPROVED',
        digest: 'f'.repeat(64),
      }),
    ).rejects.toThrow('review it again');
    await backend.request(`/tests/${draft.id}/decision`, {
      decision: 'APPROVED',
      digest: draft.digest,
    });
    const queued = await backend.request<{ id: string }>(`/projects/${project.id}/runs`, {
      testIds: [draft.id],
    });
    advance(5000);
    const report = await backend.request<Report>(`/runs/${queued.id}/report`);
    expect(report.status).toBe('SUCCEEDED');
    expect(report.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(report.approvals).toEqual([{ testId: draft.id, digest: draft.digest }]);
  });

  it('rejects invalid projects and unknown routes', async () => {
    const { backend } = setup();
    await expect(
      backend.request('/projects', {
        name: 'Bad',
        baseUrl: 'http://insecure.example',
        paths: ['/'],
        ownershipConfirmed: true,
      }),
    ).rejects.toThrow('https origin');
    await expect(backend.request('/nope')).rejects.toThrow('Not found');
  });

  it('returns copies so callers cannot mutate demo state', async () => {
    const { backend } = setup();
    const first = await backend.request<Project[]>('/projects');
    first[0].name = 'changed';
    expect((await backend.request<Project[]>('/projects'))[0].name).toBe('Acme docs portal');
  });
});
