# Security model and limits

## Implemented controls

- Origin, path and authorization confirmation are explicit and immutable through the API.
- No private, loopback, link-local, multicast, reserved or IPv4-mapped IPv6 destinations. All DNS answers are checked and a validated IP is pinned to the actual HTTP/TLS connection, while preserving the original Host and TLS server name. Revalidation happens for every document.
- Redirects are rejected. The browser never resolves target URLs itself through a continued route. The transport does not inherit HTTP proxy settings, cookies or Authorization headers.
- Only top-level GET HTML documents are fetched. All other browser requests, WebSockets, scripts, service workers, form actions, nested frames and downloads are blocked. Responses replace upstream headers with a restrictive CSP. The transport caps each response at 1 MB and eight seconds; a browser job has a three-minute deadline and at most 60 intercepted requests.
- The test DSL contains only page paths and title/heading assertions. AI output cannot add commands or arbitrary code. Evidence validation, immutable approval digests and execution-time revalidation apply independently of model behavior.
- Bearer authentication is required for all application data/actions. The token is compared in constant time, kept out of URLs and never persisted by the UI. CORS permits only the configured UI origin. Helmet supplies HTTP security headers.
- Request limits, per-process rate limits and per-project active-job checks bound accidental load. Queue jobs are stored transactionally and expired jobs are not replayed automatically.
- SQL is parameterized. Errors omit raw database/provider/browser details and credentials. Audit entries exclude token/key material. No target credentials, input values, session storage, HTML dumps, screenshots or traces are persisted.
- AI metadata transfer requires explicit consent. Common identifiers are pattern-redacted, and API response storage is disabled with `store:false`. Provider processing still occurs when enabled.
- `.env` and key/artifact paths are ignored. Local setup generates fresh credentials. CI and a source scanner check build, behavior and recognizable secret patterns.

## Limits to understand

**Read-only intent cannot guarantee that a target's GET endpoints have no side effects.** Only test authorized staging systems and choose narrow path prefixes. A denylist of action names is an additional guard, not a replacement for application-owner review. The app does not prove legal ownership of a domain.

**This is a local single-admin MVP.** The API and Chromium currently share one process identity; browser sandboxing and application-layer egress checks are defense layers, not a substitute for OS/container/network isolation. A production worker must be separate from API/DB secrets, run unprivileged in a resource-limited sandbox and have enforced outbound network rules. Never expose the development API publicly as a SaaS service.

**Metadata can contain sensitive text.** Pattern redaction does not remove all PII, secrets or confidential business content. Use synthetic data; inspect discovered evidence before enabling external generation. `store:false` is not a promise of zero provider retention under every account policy.

**AI output and discovered content are untrusted.** Schema and evidence validation prevent arbitrary execution but cannot prove that a proposed expectation is useful. Human approval and intended requirements remain necessary. No automated system can discover every missing requirement from the present UI.

**Static target support is deliberate.** Scripts are disabled, so client-only React target screens, interactive workflows and authenticated pages need a later policy design. The agent's own dashboard is React; that does not imply that it can yet safely test every React-only target application.

**Operational controls are initial.** The shared admin token has no user separation, password reset or session revocation service. Rotate it locally and restart to revoke access. DB ownership permits direct SQL modification; the API exposes no audit edit operation, but logs are not cryptographically tamper-proof. There is no artifact retention/deletion UI, cancellation endpoint, distributed rate limit or automatic backup management.

Use a secrets manager, scoped database role, HTTPS, per-user authentication/RBAC, independent approvals, egress-isolated worker containers, retention controls and a security review before a team/customer launch.

## Demo mode

The demo (`?demo`, the **Explore the demo** button, or a `VITE_DEMO_MODE=true` build) replaces the API with an in-memory stand-in inside the browser tab. It sends no requests, stores nothing, uses fictional data and does not crawl any site. Its digests are illustrative, not SHA-256; approvals made in the demo carry no meaning outside it.
