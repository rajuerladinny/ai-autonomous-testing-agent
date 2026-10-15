import React, { useCallback, useEffect, useState } from 'react';
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
} from 'lucide-react';
import type { Project, Discovery, TestCase, Run, Report } from '@agent/contracts';
import './style.css';

type EventRow = { id: string; action: string; created_at: string };
type Config = { aiEnabled: boolean; mode: string; maxTestsPerRun: number };
const friendlyTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status.toLowerCase()}`}>
      <span />
      {status}
    </span>
  );
}

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
  const [name, setName] = useState(''),
    [url, setUrl] = useState(''),
    [paths, setPaths] = useState('/'),
    [maxPages, setMaxPages] = useState(5),
    [ownership, setOwnership] = useState(false);
  const project = projects.find((p) => p.id === selected);
  const api = useCallback(
    async <T,>(path: string, body?: unknown, auth = token): Promise<T> => {
      const response = await fetch(`/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${auth}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Request failed');
      return data as T;
    },
    [token],
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
  useEffect(() => {
    if (!token || !selected) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    setDiscoveries([]);
    setTests([]);
    setRuns([]);
    setEvents([]);
    setReport(null);
    setRunIds([]);
    async function load() {
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
        if (!cancelled) timer = setTimeout(() => void load(), 4000);
      }
    }
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, selected, revision, api]);
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
  const download = (value: Report) => {
    const objectUrl = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `run-${value.id}.json`;
    a.click();
    URL.revokeObjectURL(objectUrl);
  };
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
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <small>Your token stays in this tab’s memory.</small>
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
                      note={running ? 'Work is in progress' : 'All results in one place'}
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
                    {tests.length === 0 ? (
                      <div className="empty-state">
                        <FlaskConical size={30} />
                        <h3>Your next test starts with discovery</h3>
                        <p>Discover your application, then generate your first set of drafts.</p>
                      </div>
                    ) : (
                      <div className="test-list">
                        {tests.map((t) => (
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
                        <span className="muted">Latest 50</span>
                      </div>
                      {runs.length ? (
                        runs.map((r) => (
                          <div key={r.id} className="history-row">
                            <Play size={17} />
                            <div>
                              <strong>
                                {r.results.filter((x) => x.status === 'PASSED').length} passed ·{' '}
                                {r.results.filter((x) => x.status === 'FAILED').length} failed
                              </strong>
                              <small>{friendlyTime(r.created_at)}</small>
                              {r.error && <small className="error-text">{r.error}</small>}
                            </div>
                            <Badge status={r.status} />
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
                        ))
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
                        <button className="secondary" onClick={() => download(report)}>
                          <Download size={16} />
                          Export JSON
                        </button>
                      </div>
                      {report.error && <p className="error-text">{report.error}</p>}
                      {report.results.map((r) => (
                        <div className="history-row" key={r.testId}>
                          <Badge status={r.status} />
                          <strong>{r.title}</strong>
                          <span className="muted">{r.durationMs} ms</span>
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
function Stat({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="stat">
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
