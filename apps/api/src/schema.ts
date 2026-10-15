export const schema = `
CREATE TABLE IF NOT EXISTS schema_versions (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS projects (
 id uuid PRIMARY KEY, name text NOT NULL, base_url text NOT NULL, paths jsonb NOT NULL,
 max_pages integer NOT NULL CHECK(max_pages BETWEEN 1 AND 20), ownership_confirmed boolean NOT NULL CHECK(ownership_confirmed),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS discoveries (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
 status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
 pages jsonb NOT NULL DEFAULT '[]', blocked integer NOT NULL DEFAULT 0, error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS test_cases (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), discovery_id uuid NOT NULL REFERENCES discoveries(id),
 spec jsonb NOT NULL, digest text NOT NULL CHECK(length(digest)=64),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','REJECTED')),
 source text NOT NULL CHECK(source IN ('ai','deterministic')), approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS runs (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
 status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
 results jsonb NOT NULL DEFAULT '[]', error text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS run_tests (
 run_id uuid NOT NULL REFERENCES runs(id), test_id uuid NOT NULL REFERENCES test_cases(id),
 digest text NOT NULL, spec jsonb NOT NULL, PRIMARY KEY(run_id,test_id)
);
CREATE TABLE IF NOT EXISTS jobs (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('DISCOVER','RUN')), entity_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS audit_events (
 id uuid PRIMARY KEY, action text NOT NULL, entity_id uuid NOT NULL, detail jsonb NOT NULL DEFAULT '{}',
 actor text NOT NULL DEFAULT 'local-admin', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(status,created_at);
CREATE INDEX IF NOT EXISTS tests_project_idx ON test_cases(project_id,created_at);
CREATE INDEX IF NOT EXISTS runs_project_idx ON runs(project_id,created_at);
CREATE INDEX IF NOT EXISTS discovery_project_idx ON discoveries(project_id,created_at);
INSERT INTO schema_versions(version) VALUES (1) ON CONFLICT DO NOTHING;
`;
