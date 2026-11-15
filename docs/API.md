# API contracts

Base path: `/api`. All API endpoints require `Authorization: Bearer <local admin token>`. The token is a shared local-evaluation identity, not a multi-user login system. No target credentials are accepted.

Successful reads return HTTP 200, creates/actions HTTP 201. Invalid input/policy returns 400; missing/invalid auth 401; unknown entities 404; stale approval or active work 409; rate limit 429; unexpected provider/database failure 502. Errors return `{ "statusCode": 400, "message": "Invalid request" }` (middleware errors may omit `statusCode`). Bodies are capped at 32 KiB and validated schemas reject unknown fields. UUIDs are checked before SQL queries.

| Method | Endpoint                            | Body / result                                                                       |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/health` (outside `/api`, no auth) | `{status: "ok"}` or HTTP 503                                                        |
| GET    | `/config`                           | `{aiEnabled, mode: "read-only", maxTestsPerRun: 20}`                                |
| GET    | `/projects`                         | Latest 100 projects                                                                 |
| POST   | `/projects`                         | Project input below → created project                                               |
| GET    | `/projects/:id/discoveries`         | Latest 50 discovery records                                                         |
| POST   | `/projects/:id/discoveries`         | `{}` → `{id, status: "QUEUED"}`                                                     |
| POST   | `/discoveries/:id/generate`         | `{allowExternalAi: false}` → `{source, testIds}`; must be `true` when AI is enabled |
| GET    | `/projects/:id/tests`               | Latest 200 test cases                                                               |
| POST   | `/tests/:id/decision`               | `{decision: "APPROVED" or "REJECTED", digest}` → decided test                       |
| POST   | `/projects/:id/runs`                | `{testIds: ["uuid", ...]}` → queued run; 1–20 distinct approved tests               |
| GET    | `/projects/:id/runs`                | Latest 50 runs                                                                      |
| GET    | `/runs/:id/report`                  | Run, summary and frozen approval records                                            |
| GET    | `/projects/:id/events`              | Latest 100 audit events related to that project                                     |
| POST   | `/discoveries/:id/cancel`           | Cancel a discovery that is still `QUEUED`; `409` once the worker has claimed it     |
| POST   | `/runs/:id/cancel`                  | Cancel a run that is still `QUEUED`; `409` once the worker has claimed it           |

Project input:

```json
{
  "name": "Documentation staging",
  "baseUrl": "https://staging.example.com",
  "paths": ["/docs", "/help"],
  "maxPages": 5,
  "ownershipConfirmed": true
}
```

Project response adds `id` and `created_at`. Base URLs are normalized to their exact origin. Path prefixes use segment boundaries: `/docs` allows `/docs/intro`, not `/documentation`. Query strings, fragments, percent-encoded paths, dot segments, known action names and custom ports are rejected. HTTP(S) uses standard ports only. DNS must contain only public unicast destinations.

Test specification (immutable, shared Zod schema):

```json
{
  "title": "Documentation page is available",
  "path": "/docs",
  "assertions": [
    { "kind": "title", "expected": "Documentation" },
    { "kind": "heading", "expected": "Getting started" }
  ]
}
```

Test case response wraps the spec with `id`, `project_id`, `discovery_id`, `digest`, `status`, `source`, `approved_at` and `created_at`. A title assertion compares the redacted, capped title exactly; a heading assertion requires the redacted expected text among `h1,h2` text content. These do not assert visual accessibility or business correctness.

Report shape:

```json
{
  "id": "run-uuid",
  "project_id": "project-uuid",
  "status": "SUCCEEDED",
  "results": [
    {
      "testId": "test-uuid",
      "title": "Documentation page is available",
      "status": "PASSED",
      "durationMs": 120,
      "assertions": [{ "kind": "title", "passed": true }]
    }
  ],
  "error": null,
  "created_at": "ISO-8601 timestamp",
  "finished_at": "ISO-8601 timestamp",
  "summary": { "total": 1, "passed": 1, "failed": 0 },
  "approvals": [{ "testId": "test-uuid", "digest": "64 lowercase hex characters" }]
}
```

A cancelled job is recorded as `FAILED` with the error `Cancelled before it started` and a `JOB_CANCELLED` audit event. Running jobs cannot be cancelled.

`QUEUED`/`RUNNING` reports may have no results yet. An infrastructure-failed run may have fewer results than selected tests. Clients must inspect job status as well as assertion totals.

Rate limits per API-observed IP, per process: 120 GETs/minute, 20 mutations/minute, 3 generation calls/minute. The API does not trust forwarded IP headers. The local UI polls every four seconds. A distributed deployment needs shared limits and a trusted proxy configuration.
