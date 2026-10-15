import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  Decision,
  Id,
  TestSpec,
  type Project,
  type Discovery,
  type TestCase,
  type Run,
  type Report,
} from '@agent/contracts';
import { z } from 'zod';
import type { Database, Sql } from './db.js';
import type { Generator } from './generator.js';
import { digest, validateProject, resolvePublic, validateEvidence } from './safety.js';
import type { SafeBrowser } from './browser.js';

type ProjectRow = {
  id: string;
  name: string;
  base_url: string;
  paths: string[];
  max_pages: number;
  ownership_confirmed: true;
  created_at: string;
};
function mapProject(p: ProjectRow): Project {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.base_url,
    paths: p.paths,
    maxPages: p.max_pages,
    ownershipConfirmed: p.ownership_confirmed,
    created_at: p.created_at,
  };
}
async function audit(tx: Sql, action: string, entity: string, detail: unknown = {}) {
  await tx.query('INSERT INTO audit_events(id,action,entity_id,detail) VALUES($1,$2,$3,$4)', [
    randomUUID(),
    action,
    entity,
    JSON.stringify(detail),
  ]);
}
export class AgentService {
  constructor(
    readonly db: Database,
    private readonly generator: Generator,
    private readonly browser: Pick<SafeBrowser, 'discover' | 'execute'>,
    private readonly checkHost: (hostname: string) => Promise<unknown> = resolvePublic,
    readonly aiEnabled = false,
  ) {}

  async projects() {
    return (
      await this.db.query<ProjectRow>('SELECT * FROM projects ORDER BY created_at DESC LIMIT 100')
    ).rows.map(mapProject);
  }
  async project(id: string, tx: Sql = this.db) {
    Id.parse(id);
    const row = (await tx.query<ProjectRow>('SELECT * FROM projects WHERE id=$1', [id])).rows[0];
    if (!row) throw new NotFoundException('Project not found');
    return mapProject(row);
  }
  async createProject(body: unknown) {
    const p = validateProject(body);
    await this.checkHost(new URL(p.baseUrl).hostname);
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO projects(id,name,base_url,paths,max_pages,ownership_confirmed) VALUES($1,$2,$3,$4,$5,true)',
        [id, p.name, p.baseUrl, JSON.stringify(p.paths), p.maxPages],
      );
      await audit(tx, 'PROJECT_CREATED', id, { origin: p.baseUrl, paths: p.paths });
    });
    return this.project(id);
  }
  async listDiscoveries(projectId: string) {
    await this.project(projectId);
    return (
      await this.db.query<Discovery>(
        'SELECT * FROM discoveries WHERE project_id=$1 ORDER BY created_at DESC LIMIT 50',
        [projectId],
      )
    ).rows;
  }
  async discover(projectId: string) {
    await this.project(projectId);
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      const pending = await tx.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
      void pending;
      if (
        (
          await tx.query(
            "SELECT id FROM discoveries WHERE project_id=$1 AND status IN ('QUEUED','RUNNING')",
            [projectId],
          )
        ).rows.length
      )
        throw new ConflictException('A discovery is already active');
      await tx.query("INSERT INTO discoveries(id,project_id,status) VALUES($1,$2,'QUEUED')", [
        id,
        projectId,
      ]);
      await tx.query(
        "INSERT INTO jobs(id,kind,entity_id,status) VALUES($1,'DISCOVER',$2,'QUEUED')",
        [randomUUID(), id],
      );
      await audit(tx, 'DISCOVERY_QUEUED', id);
    });
    return { id, status: 'QUEUED' };
  }
  async generate(discoveryId: string, body: unknown) {
    Id.parse(discoveryId);
    const input = z.object({ allowExternalAi: z.boolean() }).strict().parse(body);
    if (this.aiEnabled && !input.allowExternalAi)
      throw new BadRequestException(
        'Explicit consent is required to send discovery metadata to the AI provider',
      );
    const discovery = (
      await this.db.query<Discovery>(
        "SELECT * FROM discoveries WHERE id=$1 AND status='SUCCEEDED'",
        [discoveryId],
      )
    ).rows[0];
    if (!discovery) throw new NotFoundException('Completed discovery not found');
    const generated = await this.generator.generate(discovery.pages);
    const project = await this.project(discovery.project_id);
    const specs = generated.tests.map((t) => validateEvidence(t, discovery.pages));
    const ids: string[] = [];
    await this.db.transaction(async (tx) => {
      for (const spec of specs) {
        const id = randomUUID();
        ids.push(id);
        await tx.query(
          'INSERT INTO test_cases(id,project_id,discovery_id,spec,digest,source) VALUES($1,$2,$3,$4,$5,$6)',
          [
            id,
            project.id,
            discoveryId,
            JSON.stringify(spec),
            digest(spec, discoveryId),
            generated.source,
          ],
        );
      }
      await audit(tx, 'TESTS_GENERATED', discoveryId, {
        source: generated.source,
        count: ids.length,
      });
    });
    return { source: generated.source, testIds: ids };
  }
  async tests(projectId: string) {
    await this.project(projectId);
    return (
      await this.db.query<TestCase>(
        'SELECT * FROM test_cases WHERE project_id=$1 ORDER BY created_at DESC LIMIT 200',
        [projectId],
      )
    ).rows;
  }
  async decide(testId: string, body: unknown) {
    Id.parse(testId);
    const input = Decision.parse(body);
    return this.db.transaction(async (tx) => {
      const test = (
        await tx.query<TestCase>('SELECT * FROM test_cases WHERE id=$1 FOR UPDATE', [testId])
      ).rows[0];
      if (!test) throw new NotFoundException('Test not found');
      if (
        test.status !== 'DRAFT' ||
        test.digest !== input.digest ||
        digest(test.spec, test.discovery_id) !== input.digest
      )
        throw new ConflictException('Test changed or already decided; refresh before approval');
      const row = (
        await tx.query<TestCase>(
          "UPDATE test_cases SET status=$2, approved_at=CASE WHEN $2='APPROVED' THEN now() ELSE NULL END WHERE id=$1 RETURNING *",
          [testId, input.decision],
        )
      ).rows[0];
      await audit(tx, `TEST_${input.decision}`, testId, { digest: input.digest });
      return row;
    });
  }
  async createRun(projectId: string, body: unknown) {
    await this.project(projectId);
    const { testIds } = z
      .object({
        testIds: z
          .array(Id)
          .min(1)
          .max(20)
          .refine((a) => new Set(a).size === a.length),
      })
      .strict()
      .parse(body);
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
      if (
        (
          await tx.query(
            "SELECT id FROM runs WHERE project_id=$1 AND status IN ('QUEUED','RUNNING')",
            [projectId],
          )
        ).rows.length
      )
        throw new ConflictException('A run is already active');
      const tests = (
        await tx.query<TestCase>(
          'SELECT * FROM test_cases WHERE id=ANY($1::uuid[]) AND project_id=$2 FOR SHARE',
          [testIds, projectId],
        )
      ).rows;
      if (
        tests.length !== testIds.length ||
        tests.some((t) => t.status !== 'APPROVED' || digest(t.spec, t.discovery_id) !== t.digest)
      )
        throw new ConflictException('Every selected test must have a valid human approval');
      await tx.query("INSERT INTO runs(id,project_id,status) VALUES($1,$2,'QUEUED')", [
        id,
        projectId,
      ]);
      for (const test of tests)
        await tx.query('INSERT INTO run_tests(run_id,test_id,digest,spec) VALUES($1,$2,$3,$4)', [
          id,
          test.id,
          test.digest,
          JSON.stringify(test.spec),
        ]);
      await tx.query("INSERT INTO jobs(id,kind,entity_id,status) VALUES($1,'RUN',$2,'QUEUED')", [
        randomUUID(),
        id,
      ]);
      await audit(tx, 'RUN_QUEUED', id, { testIds });
    });
    return { id, status: 'QUEUED' };
  }
  async runs(projectId: string) {
    await this.project(projectId);
    return (
      await this.db.query<Run>(
        'SELECT * FROM runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 50',
        [projectId],
      )
    ).rows;
  }
  async report(runId: string): Promise<Report> {
    Id.parse(runId);
    const run = (await this.db.query<Run>('SELECT * FROM runs WHERE id=$1', [runId])).rows[0];
    if (!run) throw new NotFoundException('Run not found');
    const approvals = (
      await this.db.query<{ testId: string; digest: string }>(
        'SELECT test_id AS "testId", digest FROM run_tests WHERE run_id=$1',
        [runId],
      )
    ).rows;
    return {
      ...run,
      summary: {
        total: approvals.length,
        passed: run.results.filter((r) => r.status === 'PASSED').length,
        failed: run.results.filter((r) => r.status === 'FAILED').length,
      },
      approvals,
    };
  }
  async events(projectId: string) {
    await this.project(projectId);
    return (
      await this.db.query(
        `SELECT * FROM audit_events WHERE entity_id=$1 OR entity_id IN
      (SELECT id FROM discoveries WHERE project_id=$1 UNION SELECT id FROM test_cases WHERE project_id=$1 UNION SELECT id FROM runs WHERE project_id=$1)
      ORDER BY created_at DESC LIMIT 100`,
        [projectId],
      )
    ).rows;
  }

  async processNext(): Promise<boolean> {
    const job = await this.db.transaction(async (tx) => {
      // Expired jobs are failed, never replayed automatically after a process crash.
      const expired = (
        await tx.query<{ id: string; kind: string; entity_id: string }>(
          "UPDATE jobs SET status='FAILED',finished_at=now() WHERE status='RUNNING' AND started_at < now()-interval '10 minutes' RETURNING *",
        )
      ).rows;
      for (const row of expired) {
        const table = row.kind === 'DISCOVER' ? 'discoveries' : 'runs';
        await tx.query(
          `UPDATE ${table} SET status='FAILED',error='Worker interrupted; queue a new job' WHERE id=$1`,
          [row.entity_id],
        );
        await audit(tx, 'JOB_EXPIRED', row.entity_id);
      }
      const next = (
        await tx.query<{
          id: string;
          kind: string;
          entity_id: string;
        }>(`WITH next AS (SELECT id FROM jobs WHERE status='QUEUED' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        UPDATE jobs SET status='RUNNING',started_at=now() FROM next WHERE jobs.id=next.id RETURNING jobs.*`)
      ).rows[0];
      if (next) {
        const table = next.kind === 'DISCOVER' ? 'discoveries' : 'runs';
        await tx.query(`UPDATE ${table} SET status='RUNNING' WHERE id=$1`, [next.entity_id]);
      }
      return next;
    });
    if (!job) return false;
    const table = job.kind === 'DISCOVER' ? 'discoveries' : 'runs';
    try {
      if (job.kind === 'DISCOVER') {
        const d = (
          await this.db.query<Discovery>('SELECT * FROM discoveries WHERE id=$1', [job.entity_id])
        ).rows[0];
        const result = await this.browser.discover(await this.project(d.project_id));
        await this.db.transaction(async (tx) => {
          await tx.query(
            "UPDATE discoveries SET status='SUCCEEDED',pages=$2,blocked=$3 WHERE id=$1",
            [d.id, JSON.stringify(result.pages), result.blocked],
          );
          await tx.query("UPDATE jobs SET status='SUCCEEDED',finished_at=now() WHERE id=$1", [
            job.id,
          ]);
          await audit(tx, 'DISCOVERY_COMPLETED', d.id, {
            pages: result.pages.length,
            blocked: result.blocked,
          });
        });
      } else {
        const run = (await this.db.query<Run>('SELECT * FROM runs WHERE id=$1', [job.entity_id]))
          .rows[0];
        const tests = (
          await this.db.query<TestCase & { snapshot_spec: TestSpec; snapshot_digest: string }>(
            `SELECT t.*,rt.spec AS snapshot_spec,rt.digest AS snapshot_digest FROM run_tests rt JOIN test_cases t ON t.id=rt.test_id WHERE rt.run_id=$1 ORDER BY t.id`,
            [run.id],
          )
        ).rows;
        if (
          !tests.length ||
          tests.some(
            (t) =>
              t.status !== 'APPROVED' ||
              t.snapshot_digest !== t.digest ||
              digest(t.snapshot_spec, t.discovery_id) !== t.digest,
          )
        )
          throw new Error('Approval invalid');
        const results = await this.browser.execute(
          await this.project(run.project_id),
          tests.map((t) => ({ ...t, spec: t.snapshot_spec })),
        );
        await this.db.transaction(async (tx) => {
          await tx.query(
            "UPDATE runs SET status='SUCCEEDED',results=$2,finished_at=now() WHERE id=$1",
            [run.id, JSON.stringify(results)],
          );
          await tx.query("UPDATE jobs SET status='SUCCEEDED',finished_at=now() WHERE id=$1", [
            job.id,
          ]);
          await audit(tx, 'RUN_COMPLETED', run.id, {
            passed: results.filter((r) => r.status === 'PASSED').length,
            failed: results.filter((r) => r.status === 'FAILED').length,
          });
        });
      }
    } catch {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `UPDATE ${table} SET status='FAILED',error='Job failed: destination blocked, unavailable, browser failure, or invalid approval'${table === 'runs' ? ',finished_at=now()' : ''} WHERE id=$1`,
          [job.entity_id],
        );
        await tx.query("UPDATE jobs SET status='FAILED',finished_at=now() WHERE id=$1", [job.id]);
        await audit(tx, 'JOB_FAILED', job.entity_id);
      });
    }
    return true;
  }
}
