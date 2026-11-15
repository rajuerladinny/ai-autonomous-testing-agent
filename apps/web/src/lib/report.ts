import type { Report, Run } from '@agent/contracts';

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Escapes text for XML and drops control characters that XML 1.0 cannot carry. */
export function escapeXml(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

/** JUnit XML understood by GitHub Actions, GitLab, Jenkins and most CI dashboards. */
export function toJUnitXml(report: Report) {
  const seconds = (ms: number) => (ms / 1000).toFixed(3);
  const total = report.results.reduce((sum, r) => sum + r.durationMs, 0);
  const cases = report.results.map((r) => {
    const open = `    <testcase name="${escapeXml(r.title)}" classname="sentinel.${escapeXml(r.testId)}" time="${seconds(r.durationMs)}"`;
    if (r.status === 'PASSED') return `${open} />`;
    const failed = r.assertions
      .filter((a) => !a.passed)
      .map((a) => a.kind)
      .join(', ');
    const message = r.error ?? (failed ? `Failed assertions: ${failed}` : 'Test failed');
    return `${open}>\n      <failure message="${escapeXml(message)}" />\n    </testcase>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${report.summary.total}" failures="${report.summary.failed}" time="${seconds(total)}">`,
    `  <testsuite name="Sentinel run ${escapeXml(report.id)}" tests="${report.summary.total}" failures="${report.summary.failed}" time="${seconds(total)}" timestamp="${escapeXml(report.created_at)}">`,
    ...cases,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

/** Quotes a CSV cell and neutralises spreadsheet formula prefixes. */
export function csvCell(value: string | number) {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function toCsv(report: Report) {
  const rows = report.results.map((r) =>
    [
      r.testId,
      r.title,
      r.status,
      r.durationMs,
      r.assertions.filter((a) => a.passed).length,
      r.assertions.length,
      r.error ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [
    'test_id,title,status,duration_ms,assertions_passed,assertions_total,error',
    ...rows,
    '',
  ].join('\r\n');
}

/** Share of passed test results across finished runs, as a whole percentage. */
export function passRate(runs: Pick<Run, 'results'>[]) {
  const results = runs.flatMap((r) => r.results);
  if (!results.length) return null;
  return Math.round((results.filter((r) => r.status === 'PASSED').length / results.length) * 100);
}

export type Change = 'REGRESSED' | 'FIXED';

/** Tests whose outcome flipped between two runs. Tests present in only one run are ignored. */
export function compareRuns(
  current: Pick<Run, 'results'>,
  previous: Pick<Run, 'results'> | undefined,
) {
  const changes = new Map<string, Change>();
  if (!previous) return changes;
  const before = new Map(previous.results.map((r) => [r.testId, r.status]));
  for (const r of current.results) {
    const was = before.get(r.testId);
    if (was && was !== r.status) changes.set(r.testId, r.status === 'FAILED' ? 'REGRESSED' : 'FIXED');
  }
  return changes;
}

/** The finished run immediately before `runId` in a newest-first list. */
export function previousFinished<T extends Pick<Run, 'id' | 'status' | 'results'>>(
  runs: T[],
  runId: string,
) {
  const index = runs.findIndex((r) => r.id === runId);
  if (index < 0) return undefined;
  return runs.slice(index + 1).find((r) => r.status === 'SUCCEEDED' && r.results.length > 0);
}

export function downloadText(filename: string, text: string, type: string) {
  const objectUrl = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}
