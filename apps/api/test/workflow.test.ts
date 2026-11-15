import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AgentService } from '../src/service.js';
import { TestGenerator } from '../src/generator.js';
import { testDatabase } from './helpers.js';
import type { Database } from '../src/db.js';
import type { Project } from '@agent/contracts';
describe('PostgreSQL workflow (PGlite PostgreSQL engine)', () => {
  let db: Database, service: AgentService, project: Project;
  const browser = {
    discover: vi
      .fn()
      .mockResolvedValue({
        pages: [{ path: '/', title: 'Demo', headings: ['Hello'], links: [] }],
        blocked: 2,
      }),
    execute: vi
      .fn()
      .mockImplementation(async (_p, tests) =>
        tests.map((t: { id: string; spec: { title: string } }) => ({
          testId: t.id,
          title: t.spec.title,
          status: 'PASSED',
          durationMs: 4,
          assertions: [{ kind: 'title', passed: true }],
        })),
      ),
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    db = await testDatabase();
    service = new AgentService(db, new TestGenerator(), browser, async () => {});
    project = await service.createProject({
      name: 'Demo',
      baseUrl: 'https://example.com',
      paths: ['/'],
      maxPages: 2,
      ownershipConfirmed: true,
    });
  });
  afterEach(async () => db.close());
  async function drafts() {
    const discovery = await service.discover(project.id);
    expect(await service.processNext()).toBe(true);
    await service.generate(discovery.id, { allowExternalAi: false });
    return service.tests(project.id);
  }
  it('completes discovery → generation → approval → execution → report with audit history', async () => {
    const [test] = await drafts();
    expect(test.status).toBe('DRAFT');
    expect(test.source).toBe('deterministic');
    await service.decide(test.id, { decision: 'APPROVED', digest: test.digest });
    const run = await service.createRun(project.id, { testIds: [test.id] });
    await service.processNext();
    const report = await service.report(run.id);
    expect(report.status).toBe('SUCCEEDED');
    expect(report.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(report.approvals[0].digest).toBe(test.digest);
    const events = await service.events(project.id);
    expect(events.map((e) => e.action)).toContain('TEST_APPROVED');
    expect(events.map((e) => e.action)).toContain('RUN_COMPLETED');
    expect(await service.processNext()).toBe(false);
  });
  it('refuses to execute drafts or rejected tests', async () => {
    const [test] = await drafts();
    await expect(service.createRun(project.id, { testIds: [test.id] })).rejects.toThrow('approval');
    await service.decide(test.id, { decision: 'REJECTED', digest: test.digest });
    await expect(service.createRun(project.id, { testIds: [test.id] })).rejects.toThrow('approval');
    expect(browser.execute).not.toHaveBeenCalled();
    expect((await service.runs(project.id)).length).toBe(0);
  });
  it('rejects stale approval digests and repeat decisions', async () => {
    const [test] = await drafts();
    await expect(
      service.decide(test.id, { decision: 'APPROVED', digest: 'a'.repeat(64) }),
    ).rejects.toThrow('changed');
    await service.decide(test.id, { decision: 'APPROVED', digest: test.digest });
    await expect(
      service.decide(test.id, { decision: 'REJECTED', digest: test.digest }),
    ).rejects.toThrow('already');
  });
  it('detects a modified spec even if someone bypasses the API', async () => {
    const [test] = await drafts();
    await service.decide(test.id, { decision: 'APPROVED', digest: test.digest });
    await db.query('UPDATE test_cases SET spec=$2 WHERE id=$1', [
      test.id,
      JSON.stringify({ ...test.spec, title: 'Modified' }),
    ]);
    await expect(service.createRun(project.id, { testIds: [test.id] })).rejects.toThrow('approval');
  });
  it('revalidates the frozen snapshot at execution', async () => {
    const [test] = await drafts();
    await service.decide(test.id, { decision: 'APPROVED', digest: test.digest });
    const run = await service.createRun(project.id, { testIds: [test.id] });
    await db.query('UPDATE run_tests SET spec=$2 WHERE run_id=$1', [
      run.id,
      JSON.stringify({ ...test.spec, title: 'Tampered' }),
    ]);
    await service.processNext();
    expect((await service.report(run.id)).status).toBe('FAILED');
    expect(browser.execute).not.toHaveBeenCalled();
  });
  it('rejects cross-project tests and duplicate selections', async () => {
    const [test] = await drafts();
    await service.decide(test.id, { decision: 'APPROVED', digest: test.digest });
    const other = await service.createProject({
      name: 'Other',
      baseUrl: 'https://example.org',
      paths: ['/'],
      ownershipConfirmed: true,
    });
    await expect(service.createRun(other.id, { testIds: [test.id] })).rejects.toThrow('approval');
    await expect(service.createRun(project.id, { testIds: [test.id, test.id] })).rejects.toThrow();
  });
  it('prevents duplicate active discoveries', async () => {
    await service.discover(project.id);
    await expect(service.discover(project.id)).rejects.toThrow('active');
    expect((await service.listDiscoveries(project.id)).length).toBe(1);
  });
  it('requires explicit consent before external AI processing', async () => {
    const discovery = await service.discover(project.id);
    await service.processNext();
    const gen = { generate: vi.fn() };
    const aiService = new AgentService(db, gen, browser, async () => {}, true);
    await expect(aiService.generate(discovery.id, { allowExternalAi: false })).rejects.toThrow(
      'consent',
    );
    expect(gen.generate).not.toHaveBeenCalled();
  });
  it('fails expired jobs without replaying them', async () => {
    const discovery = await service.discover(project.id);
    await db.query("UPDATE jobs SET status='RUNNING',started_at=now()-interval '11 minutes'");
    expect(await service.processNext()).toBe(false);
    expect(
      (await service.listDiscoveries(project.id)).find((d) => d.id === discovery.id)?.status,
    ).toBe('FAILED');
    expect(browser.discover).not.toHaveBeenCalled();
  });
  it('cancels a queued discovery, never a finished or unknown one', async () => {
    const discovery = await service.discover(project.id);
    expect(await service.cancel('DISCOVER', discovery.id)).toEqual({
      id: discovery.id,
      status: 'FAILED',
    });
    expect(await service.processNext()).toBe(false);
    expect(browser.discover).not.toHaveBeenCalled();
    const [cancelled] = await service.listDiscoveries(project.id);
    expect(cancelled.status).toBe('FAILED');
    expect(cancelled.error).toBe('Cancelled before it started');
    await expect(service.cancel('DISCOVER', discovery.id)).rejects.toThrow('queued');
    await expect(service.cancel('RUN', discovery.id)).rejects.toThrow('not found');
    await expect(service.cancel('RUN', randomUUID())).rejects.toThrow('not found');
    expect((await service.events(project.id)).map((e) => e.action)).toContain('JOB_CANCELLED');
    // Cancelling frees the project for a new discovery.
    await service.discover(project.id);
    expect(await service.processNext()).toBe(true);
    expect(browser.discover).toHaveBeenCalledTimes(1);
  });
  it('cancels a queued run without executing it or touching approvals', async () => {
    const [test] = await drafts();
    await service.decide(test.id, { decision: 'APPROVED', digest: test.digest });
    const run = await service.createRun(project.id, { testIds: [test.id] });
    await service.cancel('RUN', run.id);
    expect(await service.processNext()).toBe(false);
    expect(browser.execute).not.toHaveBeenCalled();
    const report = await service.report(run.id);
    expect(report.status).toBe('FAILED');
    expect(report.error).toBe('Cancelled before it started');
    expect(report.finished_at).not.toBeNull();
    expect((await service.tests(project.id))[0].status).toBe('APPROVED');
  });
  it('refuses to cancel a job the worker has already finished', async () => {
    const discovery = await service.discover(project.id);
    expect(await service.processNext()).toBe(true);
    await expect(service.cancel('DISCOVER', discovery.id)).rejects.toThrow('queued');
    expect((await service.listDiscoveries(project.id))[0].status).toBe('SUCCEEDED');
  });
  it('never generates from incomplete discoveries', async () => {
    const d = await service.discover(project.id);
    await expect(service.generate(d.id, { allowExternalAi: false })).rejects.toThrow('Completed');
  });
  it('returns a not-found response for nonexistent IDs', async () => {
    await expect(service.project(randomUUID())).rejects.toThrow('not found');
  });
});
