import { describe, expect, it } from 'vitest';
import type { Report } from '@agent/contracts';
import { csvCell, escapeXml, passRate, toCsv, toJUnitXml } from './report';

const report: Report = {
  id: 'run-1',
  project_id: 'p-1',
  status: 'SUCCEEDED',
  error: null,
  created_at: '2026-01-02T03:04:05.000Z',
  finished_at: '2026-01-02T03:04:09.000Z',
  results: [
    {
      testId: 't-1',
      title: 'Check /',
      status: 'PASSED',
      durationMs: 250,
      assertions: [{ kind: 'title', passed: true }],
    },
    {
      testId: 't-2',
      title: 'Check <b>"docs" & more',
      status: 'FAILED',
      durationMs: 1250,
      assertions: [
        { kind: 'title', passed: true },
        { kind: 'heading', passed: false },
      ],
    },
  ],
  summary: { total: 2, passed: 1, failed: 1 },
  approvals: [],
};

describe('report exports', () => {
  it('escapes XML and strips control characters', () => {
    expect(escapeXml(`a<b>&"'\u0001c`)).toBe('a&lt;b&gt;&amp;&quot;&apos;c');
  });
  it('writes JUnit XML with totals, durations and failures', () => {
    const xml = toJUnitXml(report);
    expect(xml).toContain('<testsuites tests="2" failures="1" time="1.500">');
    expect(xml).toContain('<testcase name="Check /" classname="sentinel.t-1" time="0.250" />');
    expect(xml).toContain('name="Check &lt;b&gt;&quot;docs&quot; &amp; more"');
    expect(xml).toContain('<failure message="Failed assertions: heading" />');
    expect(xml).not.toContain('<b>');
  });
  it('prefers the recorded error as the failure message', () => {
    const withError = {
      ...report,
      results: [{ ...report.results[1], error: 'Page unavailable' }],
    };
    expect(toJUnitXml(withError)).toContain('<failure message="Page unavailable" />');
  });
  it('quotes CSV cells and neutralises formulas', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(csvCell(42)).toBe('"42"');
  });
  it('writes one CSV row per result', () => {
    const lines = toCsv(report).trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'test_id,title,status,duration_ms,assertions_passed,assertions_total,error',
    );
    expect(lines[2]).toBe('"t-2","Check <b>""docs"" & more","FAILED","1250","1","2",""');
  });
  it('computes the pass rate across runs', () => {
    expect(passRate([])).toBeNull();
    expect(passRate([{ results: [] }])).toBeNull();
    expect(passRate([report, { results: [report.results[0]] }])).toBe(67);
  });
});
