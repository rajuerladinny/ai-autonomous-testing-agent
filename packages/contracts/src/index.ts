import { z } from 'zod';

export const ProjectInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    baseUrl: z.string().url().max(500),
    paths: z.array(z.string().min(1).max(200)).min(1).max(20),
    maxPages: z.number().int().min(1).max(20).default(5),
    ownershipConfirmed: z.literal(true),
  })
  .strict();
export type ProjectInput = z.infer<typeof ProjectInput>;
export type Project = ProjectInput & { id: string; created_at: string };

export const Assertion = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('title'), expected: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('heading'), expected: z.string().min(1).max(200) }).strict(),
]);
export const TestSpec = z
  .object({
    title: z.string().min(1).max(120),
    path: z.string().min(1).max(200),
    assertions: z.array(Assertion).min(1).max(5),
  })
  .strict();
export type TestSpec = z.infer<typeof TestSpec>;
export const GeneratedSuite = z.object({ tests: z.array(TestSpec).min(1).max(20) }).strict();
export const Decision = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const Id = z.string().uuid();
export type PageSnapshot = { path: string; title: string; headings: string[]; links: string[] };
export type Discovery = {
  id: string;
  project_id: string;
  status: JobStatus;
  pages: PageSnapshot[];
  blocked: number;
  error: string | null;
  created_at: string;
};
export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type TestCase = {
  id: string;
  project_id: string;
  discovery_id: string;
  spec: TestSpec;
  digest: string;
  status: 'DRAFT' | 'APPROVED' | 'REJECTED';
  source: 'ai' | 'deterministic';
  approved_at: string | null;
  created_at: string;
};
export type CaseResult = {
  testId: string;
  title: string;
  status: 'PASSED' | 'FAILED';
  durationMs: number;
  assertions: { kind: string; passed: boolean }[];
  error?: string;
};
export type Run = {
  id: string;
  project_id: string;
  status: JobStatus;
  results: CaseResult[];
  error: string | null;
  created_at: string;
  finished_at: string | null;
};
export type Report = Run & {
  summary: { total: number; passed: number; failed: number };
  approvals: { testId: string; digest: string }[];
};
