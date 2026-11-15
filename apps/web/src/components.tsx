import React from 'react';
import type { Run } from '@agent/contracts';

export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status.toLowerCase()}`}>
      <span />
      {status}
    </span>
  );
}

export function Stat({
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

/** One bar per finished run, oldest first: height is the pass share, red marks any failure. */
export function RunTrend({ runs }: { runs: Run[] }) {
  const finished = runs
    .filter((r) => r.status === 'SUCCEEDED' && r.results.length > 0)
    .slice(0, 12)
    .reverse();
  if (finished.length < 2) return null;
  return (
    <div
      className="trend"
      role="img"
      aria-label={`Pass share of the last ${finished.length} finished runs`}
    >
      {finished.map((r) => {
        const passed = r.results.filter((x) => x.status === 'PASSED').length;
        const share = passed / r.results.length;
        return (
          <span
            key={r.id}
            className={share === 1 ? 'ok' : 'bad'}
            style={{ height: `${Math.max(15, Math.round(share * 100))}%` }}
            title={`${passed} of ${r.results.length} passed`}
          />
        );
      })}
    </div>
  );
}

/** Keeps a rendering fault from leaving a blank page. */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="crash">
        <h1>Something went wrong</h1>
        <p>The workspace hit an unexpected error. Reloading clears it; your data is unaffected.</p>
        <button className="primary" onClick={() => window.location.reload()}>
          Reload workspace
        </button>
      </main>
    );
  }
}
