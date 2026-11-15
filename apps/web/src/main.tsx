import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ShieldCheck,
  Radar,
  FlaskConical,
  Play,
  ArrowUpRight,
  Plus,
  Check,
  X,
  Download,
  LogOut,
  Activity,
  LockKeyhole,
  ChevronRight,
  LoaderCircle,
  FileCheck2,
  Search,
  Sparkles,
  Ban,
  RotateCcw,
  ListChecks,
} from 'lucide-react';
import type { Project, Discovery, TestCase, Run, Report } from '@agent/contracts';
import { httpRequest, type Backend, type Config, type EventRow } from './lib/api';
import { createDemoBackend } from './lib/demo';
import {
  compareRuns,
  downloadText,
  passRate,
  previousFinished,
  toCsv,
  toJUnitXml,
} from './lib/report';
import { Badge, ErrorBoundary, RunTrend, Stat } from './components';
import './style.css';

// Set by the Vite config for demo builds; absent when the UI is served without it.
declare const __DEMO__: boolean | undefined;
const DEMO_BUILD = typeof __DEMO__ !== 'undefined' && __DEMO__ === true;
const DEMO_TOKEN = 'demo';
const STATUS_FILTERS = ['ALL', 'DRAFT', 'APPROVED', 'REJECTED'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const friendlyTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

function App() {
  const [token, setToken] = useState(''),
    [credential, setCredential] = useState(''),
    [projects, setProjects] = useState<Project[]>([]),
    [selected, setSelected] = useState('');
  const [config, setConfig] = useState<Config | null>(null),
    [discoveries, setDiscoveries] = useState<Discovery[]>([]),
    [tests, setTests] = useState<TestCase[]>([]),
    [runs, setRuns] = useState<Run[]>([]),
    [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [add, setAdd] = useState(false),
    [tab, setTab] = useState<'workspace' | 'activity'>('workspace');
  const [runIds, setRunIds] = useState<string[]>([]),
    [consent, setConsent] = useState(false),
    [report, setReport] = useState<Report | null>(null);
  const [demo, setDemo] = useState<Backend | null>(null),
    [filter, setFilter] = useState<StatusFilter>('ALL'),
    [query, setQuery] = useState('');
  const [name, setName] = useState(''),
    [url, setUrl] = useState(''),
    [paths, setPaths] = useState('/'),
    [maxPages, setMaxPages] = useState(5),
    [ownership, setOwnership] = useState(false);
  const project = projects.find((p) => p.id === selected);
  const api = useCallback(
    <T,>(path: string, body?: unknown, auth = token): Promise<T> =>
      demo ? demo.request<T>(path, body) : httpRequest<T>(path, body, auth),
    [token, demo],
  );
  const action = async (fn: () => Promise<void>, refresh = true) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      if (refresh) setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };
  const login = (e: React.FormEvent) => {
    e.preventDefault();
    void action(async () => {
      const [c, p] = await Promise.all([
        api<Config>('/config', undefined, credential),
        api<Project[]>('/projects', undefined, credential),
      ]);
      setConfig(c);
      setProjects(p);
      setSelected(p[0]?.id ?? '');
      setToken(credential);
      setCredential('');
      setAdd(p.length === 0);
    });
  };
  const startDemo = useCallback(() => {
    const backend = createDemoBackend();
    setBusy(true);
    setError('');
    void Promise.all([backend.request<Config>('/config'), backend.request<Project[]>('/projects')])
      .then(([c, p]) => {
        setDemo(backend);
        setConfig(c);
        setProjects(p);
        setSelected(p[0]?.id ?? '');
        setToken(DEMO_TOKEN);
        setAdd(false);
      })
      .catch(() => setError('The demo could not start'))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => {
    if (DEMO_BUILD || new URLSearchParams(window.location.search).has('demo')) startDemo();
  }, [startDemo]);
  // Clear project-scoped state only when the project changes, so a refresh after an
  // action updates the lists in place instead of flashing the empty state.
  useEffect(() => {
    setDiscoveries([]);
    setTests([]);
    setRuns([]);
    setEvents([]);
    setReport(null);
    setRunIds([]);
    setFilter('ALL');
    setQuery('');
  }, [token, selected]);
  useEffect(() => {
    if (!token || !selected) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    async function load() {
      // Skip polling while the tab is in the background.
      if (document.hidden) {
        timer = setTimeout(() => void load(), 1000);
        return;
      }
      try {
        const [d, t, r, a] = await Promise.all([
          api<Discovery[]>(`/projects/${selected}/discoveries`),
          api<TestCase[]>(`/projects/${selected}/tests`),
          api<Run[]>(`/projects/${selected}/runs`),
          api<EventRow[]>(`/projects/${selected}/events`),
        ]);
        if (!cancelled) {
          setDiscoveries(d);
          setTests(t);
          setRuns(r);
          setEvents(a);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not refresh');
      } finally {
        if (!cancelled) timer = setTimeout(() => void load(), demo ? 1200 : 4000);
      }
    }
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, selected, revision, api, demo]);
  const create = (e: React.FormEvent) => {
    e.preventDefault();
    void action(async () => {
      const p = await api<Project>('/projects', {
        name,
        baseUrl: url,
        paths: paths.split(',').map((s) => s.trim()),
        maxPages,
        ownershipConfirmed: ownership,
      });
      setProjects((old) => [p, ...old]);
      setSelected(p.id);
      setAdd(false);
      setName('');
      setUrl('');
      setOwnership(false);
      setConsent(false);
    });
  };
  const download = (value: Report) =>
    downloadText(`run-${value.id}.json`, JSON.stringify(value, null, 2), 'application/json');
  const visibleTests = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tests.filter(
      (t) =>
        (filter === 'ALL' || t.status === filter) &&
        (!needle ||
          t.spec.title.toLowerCase().includes(needle) ||
          t.spec.path.toLowerCase().includes(needle)),
    );
  }, [tests, filter, query]);
  const rate = useMemo(() => passRate(runs), [runs]);
  if (!token)
    return (
      <main className="login">
        <div className="login-card">
          <div className="brand">
            <span className="brand-mark">
              <ShieldCheck size={25} />
            </span>
            sentinel<span className="beta">MVP</span>
          </div>
          <div className="eyebrow">YOUR WEB QUALITY WORKSPACE</div>
          <h1>
            Explore safely.
            <br />
            Test with confidence.
          </h1>
          <p>Discover your application, review suggested tests, and approve exactly what runs.</p>
          <form onSubmit={login}>
            <label htmlFor="token">Workspace admin token</label>
            <input
              id="token"
              type="password"
              autoComplete="off"
              required
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder="Enter your local admin token"
            />
            <button disabled={busy} className="primary">
              {busy ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={17} />}Unlock
              workspace
              <ArrowUpRight size={17} />
            </button>
          </form>
          <button
            type="button"
            disabled={busy}
            className="secondary demo-button"
            onClick={startDemo}
          >
            <Sparkles size={16} />
            Explore the demo
          </button>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <small>
            Your token stays in this tab’s memory. The demo uses sample data and needs no token.
          </small>
        </div>
        <div className="login-art">
          <Radar size={180} strokeWidth={0.7} />
          <div className="orb one" />
          <div className="orb two" />
          <p>
            A little autonomy.
            <br />
            <strong>A lot of control.</strong>
          </p>
        </div>
      </main>
    );

  const approved = tests.filter((t) => t.status === 'APPROVED'),
    latest = discoveries.find((d) => d.status === 'SUCCEEDED');
  const approvedIds = new Set(approved.map((t) => t.id));
  const reportChanges = report
    ? compareRuns(report, previousFinished(runs, report.id))
    : new Map<string, 'REGRESSED' | 'FIXED'>();
  const running =
    discoveries.some((d) => d.status === 'QUEUED' || d.status === 'RUNNING') ||
    runs.some((r) => r.status === 'QUEUED' || r.status === 'RUNNING');
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span className="brand-mark">
            <ShieldCheck size={24} />
          </span>
          sentinel
        </div>
        <div className="workspace-label">
          TESTING WORKSPACE<span>MVP 0.1</span>
        </div>
        <nav>
          <button
            className={tab === 'workspace' ? 'active' : ''}
            onClick={() => setTab('workspace')}
          >
            <Radar size={19} />
            Overview
            <ChevronRight size={16} />
          </button>
          <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
            <Activity size={19} />
            Activity log
          </button>
        </nav>
        <div className="safety-card">
          <ShieldCheck size={22} />
          <strong>Human in control</strong>
          <p>Every test needs your approval. Discovery stays read-only.</p>
          <span className="tiny-dot" />
          Safety policies enabled
        </div>
        <button
          className="signout"
          onClick={() => {
            setToken('');
            setDemo(null);
            setConfig(null);
            setProjects([]);
            setSelected('');
            setDiscoveries([]);
            setTests([]);
            setRuns([]);
            setEvents([]);
            setReport(null);
            setConsent(false);
          }}
        >
          <LogOut size={17} />
          Lock workspace
        </button>
      </aside>
      <div className="main">
        <header>
          <div>
            <span className="muted">Workspace</span>
            <ChevronRight size={14} />
            <span>{tab === 'workspace' ? 'Overview' : 'Activity log'}</span>
          </div>
          <div className="header-status">
            <span className="tiny-dot" />
            Read-only discovery<div className="avatar">A</div>
          </div>
        </header>
        <main className="content">
          <div className="page-title">
            <div>
              <div className="eyebrow">AUTONOMOUS TESTING, WITH GUARDRAILS</div>
              <h1>
                Your quality command center<span>.</span>
              </h1>
              <p>From application discovery to a result you can trust.</p>
            </div>
            <button className="secondary" onClick={() => setAdd((v) => !v)}>
              <Plus size={17} />
              New project
            </button>
          </div>
          {demo && (
            <div className="demo-banner" role="status">
              <Sparkles size={16} />
              <span>
                <strong>Demo mode.</strong> Sample data, simulated jobs, nothing leaves your
                browser. Reloading resets it.
              </span>
            </div>
          )}
          {error && (
            <div role="alert" className="error">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={17} />
              </button>
            </div>
          )}
          {add && (
            <section className="panel project-form">
              <h2>Connect an application</h2>
              <p>
                Use a public test environment that you own or are authorized to test. Discovery
                reads server-rendered HTML.
              </p>
              <form onSubmit={create}>
                <div className="form-grid">
                  <label>
                    Project name
                    <input
                      required
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Customer portal"
                    />
                  </label>
                  <label>
                    Application origin
                    <input
                      required
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://staging.example.com"
                    />
                  </label>
                  <label>
                    Allowed path prefixes, comma separated
                    <input
                      required
                      value={paths}
                      onChange={(e) => setPaths(e.target.value)}
                      placeholder="/docs, /about"
                    />
                  </label>
                  <label>
                    Maximum pages
                    <input
                      required
                      type="number"
                      min={1}
                      max={20}
                      value={maxPages}
                      onChange={(e) => setMaxPages(Number(e.target.value))}
                    />
                  </label>
                </div>
                <label className="check">
                  <input
                    required
                    type="checkbox"
                    checked={ownership}
                    onChange={(e) => setOwnership(e.target.checked)}
                  />
                  I own this environment or have permission to test it.
                </label>
                <button disabled={busy} className="primary">
                  <Plus size={16} />
                  Create project
                </button>
              </form>
            </section>
          )}
          {project ? (
            <>
              <div className="project-bar">
                <div className="project-icon">
                  <FlaskConical size={21} />
                </div>
                <div>
                  <label htmlFor="project">ACTIVE PROJECT</label>
                  <select
                    id="project"
                    value={selected}
                    onChange={(e) => {
                      setSelected(e.target.value);
                      setConsent(false);
                    }}
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <span className="project-url">{project.baseUrl}</span>
                <span className="scope">
                  {project.maxPages} page limit · {project.paths.join(', ')}
                </span>
              </div>
              {tab === 'activity' ? (
                <section className="panel">
                  <div className="section-head">
                    <h2>Workspace activity</h2>
                    <span className="muted">Latest 100 events</span>
                  </div>
                  {events.length ? (
                    events.map((e) => (
                      <div className="event" key={e.id}>
                        <Activity size={16} />
                        <span>{e.action.replaceAll('_', ' ').toLowerCase()}</span>
                        <time>{friendlyTime(e.created_at)}</time>
                      </div>
                    ))
                  ) : (
                    <p className="empty">Activity will appear here as you work.</p>
                  )}
                </section>
              ) : (
                <>
                  <div className="stats">
                    <Stat
                      label="Pages discovered"
                      value={String(latest?.pages.length ?? 0)}
                      note="Within your approved scope"
                      icon={<Radar size={21} />}
                    />
                    <Stat
                      label="Tests to review"
                      value={String(tests.filter((t) => t.status === 'DRAFT').length)}
                      note="Your approval is required"
                      icon={<FileCheck2 size={21} />}
                    />
                    <Stat
                      label="Approved tests"
                      value={String(approved.length)}
                      note="Ready for safe execution"
                      icon={<ShieldCheck size={21} />}
                    />
                    <Stat
                      label="Test runs"
                      value={String(runs.length)}
                      note={
                        running
                          ? 'Work is in progress'
                          : rate === null
                            ? 'All results in one place'
                            : `${rate}% of results passed`
                      }
                      icon={<Play size={21} />}
                    />
                  </div>
                  <section className="workflow">
                    <div>
                      <span className="step">01</span>
                      <h3>Discover</h3>
                      <p>Map approved pages.</p>
                      <button
                        disabled={busy || running}
                        onClick={() =>
                          void action(async () => {
                            await api(`/projects/${selected}/discoveries`, {});
                          })
                        }
                        className="secondary"
                      >
                        <Radar size={16} />
                        Start discovery
                      </button>
                    </div>
                    <ChevronRight className="step-arrow" />
                    <div>
                      <span className="step">02</span>
                      <h3>Generate & review</h3>
                      <p>
                        {config?.aiEnabled
                          ? 'AI suggestions grounded in discovery.'
                          : 'Deterministic mode · no AI key configured.'}
                      </p>
                      {config?.aiEnabled && (
                        <label className="check consent">
                          <input
                            type="checkbox"
                            checked={consent}
                            onChange={(e) => setConsent(e.target.checked)}
                          />
                          Allow sending page paths, titles and headings to OpenAI. These may contain
                          sensitive text.
                        </label>
                      )}
                      <button
                        disabled={busy || !latest || (config?.aiEnabled && !consent)}
                        onClick={() =>
                          void action(async () => {
                            await api(`/discoveries/${latest!.id}/generate`, {
                              allowExternalAi: consent,
                            });
                          })
                        }
                        className="secondary"
                      >
                        <FlaskConical size={16} />
                        Generate drafts
                      </button>
                    </div>
                    <ChevronRight className="step-arrow" />
                    <div>
                      <span className="step">03</span>
                      <h3>Run & report</h3>
                      <p>Select approved tests below.</p>
                      <button
                        disabled={busy || running || runIds.length === 0}
                        onClick={() =>
                          void action(async () => {
                            await api(`/projects/${selected}/runs`, { testIds: runIds });
                            setRunIds([]);
                          })
                        }
                        className="primary"
                      >
                        <Play size={16} />
                        Run selected ({runIds.length})
                      </button>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="section-head">
                      <div>
                        <h2>
                          Test review queue <span className="count">{tests.length}</span>
                        </h2>
                        <p>
                          Review the full specification before approving. No generated code is
                          executed.
                        </p>
                      </div>
                      <span className="muted">Showing latest 200</span>
                    </div>
                    {tests.length > 0 && (
                      <div className="filter-bar">
                        <div className="filter-tabs" role="group" aria-label="Filter by status">
                          {STATUS_FILTERS.map((f) => (
                            <button
                              key={f}
                              type="button"
                              aria-pressed={filter === f}
                              className={filter === f ? 'active' : ''}
                              onClick={() => setFilter(f)}
                            >
                              {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
                              <span>
                                {f === 'ALL'
                                  ? tests.length
                                  : tests.filter((t) => t.status === f).length}
                              </span>
                            </button>
                          ))}
                        </div>
                        <div className="selection-actions">
                          <button
                            type="button"
                            className="quiet"
                            disabled={!visibleTests.some((t) => t.status === 'APPROVED')}
                            onClick={() =>
                              setRunIds(
                                visibleTests
                                  .filter((t) => t.status === 'APPROVED')
                                  .slice(0, 20)
                                  .map((t) => t.id),
                              )
                            }
                          >
                            <ListChecks size={14} />
                            Select approved
                          </button>
                          {runIds.length > 0 && (
                            <button type="button" className="quiet" onClick={() => setRunIds([])}>
                              <X size={14} />
                              Clear
                            </button>
                          )}
                        </div>
                        <div className="search">
                          <Search size={15} />
                          <input
                            type="search"
                            aria-label="Search tests"
                            placeholder="Search by title or path"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                    {tests.length === 0 ? (
                      <div className="empty-state">
                        <FlaskConical size={30} />
                        <h3>Your next test starts with discovery</h3>
                        <p>Discover your application, then generate your first set of drafts.</p>
                      </div>
                    ) : visibleTests.length === 0 ? (
                      <p className="empty">No tests match this filter.</p>
                    ) : (
                      <div className="test-list">
                        {visibleTests.map((t) => (
                          <article key={t.id} className="test-card">
                            <div className="test-title">
                              {t.status === 'APPROVED' ? (
                                <input
                                  aria-label={`Select ${t.spec.title}`}
                                  type="checkbox"
                                  checked={runIds.includes(t.id)}
                                  disabled={!runIds.includes(t.id) && runIds.length >= 20}
                                  onChange={(e) =>
                                    setRunIds((old) =>
                                      e.target.checked
                                        ? [...old, t.id]
                                        : old.filter((id) => id !== t.id),
                                    )
                                  }
                                />
                              ) : (
                                <FileCheck2 size={18} className="muted" />
                              )}
                              <h3>{t.spec.title}</h3>
                              <Badge status={t.status} />
                              <span className="source">
                                {t.source === 'ai' ? 'AI assisted' : 'Deterministic'}
                              </span>
                            </div>
                            <div className="spec">
                              <code>GET {t.spec.path}</code>
                              {t.spec.assertions.map((a, i) => (
                                <div key={i}>
                                  <Check size={13} />
                                  <span>
                                    {a.kind} equals <strong>{a.expected}</strong>
                                  </span>
                                </div>
                              ))}
                            </div>
                            <div className="test-footer">
                              <span title={t.digest}>
                                Approval digest <code>{t.digest.slice(0, 16)}…</code>
                              </span>
                              {t.status === 'DRAFT' && (
                                <div>
                                  <button
                                    disabled={busy}
                                    className="quiet"
                                    onClick={() =>
                                      void action(async () => {
                                        await api(`/tests/${t.id}/decision`, {
                                          decision: 'REJECTED',
                                          digest: t.digest,
                                        });
                                      })
                                    }
                                  >
                                    <X size={14} />
                                    Reject
                                  </button>
                                  <button
                                    disabled={busy}
                                    className="approve"
                                    onClick={() =>
                                      void action(async () => {
                                        await api(`/tests/${t.id}/decision`, {
                                          decision: 'APPROVED',
                                          digest: t.digest,
                                        });
                                      })
                                    }
                                  >
                                    <Check size={15} />
                                    Approve test
                                  </button>
                                </div>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                  <div className="bottom-grid">
                    <section className="panel">
                      <div className="section-head">
                        <h2>Discovery history</h2>
                        <span className="muted">Latest 50</span>
                      </div>
                      {discoveries.length ? (
                        discoveries.map((d) => (
                          <div key={d.id} className="history-row">
                            <Radar size={17} />
                            <div>
                              <strong>{d.pages.length} pages mapped</strong>
                              <small>
                                {friendlyTime(d.created_at)} · {d.blocked} requests blocked
                              </small>
                              {d.error && <small className="error-text">{d.error}</small>}
                            </div>
                            <Badge status={d.status} />
                            {d.status === 'QUEUED' && (
                              <button
                                className="icon-button"
                                aria-label="Cancel queued discovery"
                                title="Cancel before it starts"
                                disabled={busy}
                                onClick={() =>
                                  void action(async () => {
                                    await api(`/discoveries/${d.id}/cancel`, {});
                                  })
                                }
                              >
                                <Ban size={16} />
                              </button>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="empty">No discoveries yet.</p>
                      )}
                      {latest && (
                        <details className="evidence">
                          <summary>Inspect discovered evidence</summary>
                          {latest.pages.map((p) => (
                            <div key={p.path}>
                              <code>{p.path}</code>
                              <strong>{p.title}</strong>
                              {p.headings.map((h, i) => (
                                <small key={i}>{h}</small>
                              ))}
                            </div>
                          ))}
                        </details>
                      )}
                    </section>
                    <section className="panel">
                      <div className="section-head">
                        <h2>Execution reports</h2>
                        <RunTrend runs={runs} />
                        <span className="muted">Latest 50</span>
                      </div>
                      {runs.length ? (
                        runs.map((r) => {
                          const changes = [
                            ...compareRuns(r, previousFinished(runs, r.id)).values(),
                          ];
                          const regressed = changes.filter((c) => c === 'REGRESSED').length;
                          const fixed = changes.length - regressed;
                          const rerunIds = r.results
                            .map((x) => x.testId)
                            .filter((id) => approvedIds.has(id));
                          return (
                          <div key={r.id} className="history-row">
                            <Play size={17} />
                            <div>
                              <strong>
                                {r.results.filter((x) => x.status === 'PASSED').length} passed ·{' '}
                                {r.results.filter((x) => x.status === 'FAILED').length} failed
                              </strong>
                              <small>{friendlyTime(r.created_at)}</small>
                              {regressed > 0 && (
                                <small className="error-text">
                                  {regressed} new {regressed === 1 ? 'failure' : 'failures'} since
                                  the previous run
                                </small>
                              )}
                              {fixed > 0 && (
                                <small className="fixed-text">{fixed} fixed since the previous run</small>
                              )}
                              {r.error && <small className="error-text">{r.error}</small>}
                            </div>
                            <Badge status={r.status} />
                            {r.status === 'QUEUED' && (
                              <button
                                className="icon-button"
                                aria-label="Cancel queued run"
                                title="Cancel before it starts"
                                disabled={busy}
                                onClick={() =>
                                  void action(async () => {
                                    await api(`/runs/${r.id}/cancel`, {});
                                  })
                                }
                              >
                                <Ban size={16} />
                              </button>
                            )}
                            {r.status === 'SUCCEEDED' && r.results.length > 0 && (
                              <button
                                className="icon-button"
                                aria-label="Run these tests again"
                                title="Run these tests again"
                                disabled={busy || running || rerunIds.length === 0}
                                onClick={() =>
                                  void action(async () => {
                                    await api(`/projects/${selected}/runs`, { testIds: rerunIds });
                                  })
                                }
                              >
                                <RotateCcw size={16} />
                              </button>
                            )}
                            <button
                              className="icon-button"
                              aria-label="View run report"
                              onClick={() =>
                                void action(
                                  async () => setReport(await api<Report>(`/runs/${r.id}/report`)),
                                  false,
                                )
                              }
                            >
                              <ArrowUpRight size={17} />
                            </button>
                          </div>
                          );
                        })
                      ) : (
                        <p className="empty">Approved tests are ready when you are.</p>
                      )}
                    </section>
                  </div>
                  {report && (
                    <section className="panel report">
                      <div className="section-head">
                        <div>
                          <h2>Run details</h2>
                          <p>
                            {report.summary.passed} passed · {report.summary.failed} failed ·{' '}
                            {report.summary.total} selected
                          </p>
                        </div>
                        <div className="export-actions">
                          <button className="secondary" onClick={() => download(report)}>
                            <Download size={16} />
                            Export JSON
                          </button>
                          <button
                            className="secondary"
                            onClick={() =>
                              downloadText(
                                `run-${report.id}.junit.xml`,
                                toJUnitXml(report),
                                'application/xml',
                              )
                            }
                          >
                            <Download size={16} />
                            JUnit XML
                          </button>
                          <button
                            className="secondary"
                            onClick={() =>
                              downloadText(`run-${report.id}.csv`, toCsv(report), 'text/csv')
                            }
                          >
                            <Download size={16} />
                            CSV
                          </button>
                        </div>
                      </div>
                      {report.error && <p className="error-text">{report.error}</p>}
                      {report.results.map((r) => (
                        <div className="history-row" key={r.testId}>
                          <Badge status={r.status} />
                          <strong>{r.title}</strong>
                          {reportChanges.has(r.testId) && (
                            <span
                              className={`change ${reportChanges.get(r.testId) === 'REGRESSED' ? 'regressed' : 'fixed'}`}
                            >
                              {reportChanges.get(r.testId) === 'REGRESSED' ? 'New failure' : 'Fixed'}
                            </span>
                          )}
                          <span className="muted">
                            {r.assertions.filter((a) => a.passed).length}/{r.assertions.length}{' '}
                            assertions · {r.durationMs} ms
                          </span>
                          {r.error && <span>{r.error}</span>}
                        </div>
                      ))}
                      <details>
                        <summary>Approval records and assertion results</summary>
                        <pre>{JSON.stringify(report, null, 2)}</pre>
                      </details>
                    </section>
                  )}
                </>
              )}
            </>
          ) : (
            !add && (
              <section className="panel empty-state">
                <Radar size={34} />
                <h2>Connect your first application</h2>
                <p>Create a project to choose your application and discovery scope.</p>
                <button className="primary" onClick={() => setAdd(true)}>
                  <Plus size={16} />
                  New project
                </button>
              </section>
            )
          )}
          <footer>
            <ShieldCheck size={14} />
            Bounded discovery. Explicit approval. Traceable results.
            <span>Sentinel · Initial MVP</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
