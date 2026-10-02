// T4.6.04: the gate fails under 90 and names the audits to fix (tests/lighthouse/score.ts).
import { describe, expect, it } from 'vitest';
import { failures, medianRun, scorePage, summary, topAudits, type Lhr } from './score';

function lhr(perf: number | null, a11y: number | null, extra: Partial<Lhr> = {}): Lhr {
  return {
    categories: {
      performance: {
        score: perf,
        auditRefs: [
          { id: 'largest-contentful-paint', weight: 25 },
          { id: 'total-blocking-time', weight: 30 },
          { id: 'cumulative-layout-shift', weight: 25 },
          { id: 'first-contentful-paint', weight: 10 },
          { id: 'render-blocking-insight', weight: 0 },
        ],
      },
      accessibility: {
        score: a11y,
        auditRefs: [
          { id: 'color-contrast', weight: 7 },
          { id: 'label', weight: 7 },
        ],
      },
    },
    audits: {
      'largest-contentful-paint': { title: 'Largest Contentful Paint', score: 0.4, displayValue: '4.1 s' },
      'total-blocking-time': { title: 'Total Blocking Time', score: 0.95 },
      'cumulative-layout-shift': { title: 'Cumulative Layout Shift', score: 0.5 },
      'first-contentful-paint': { title: 'First Contentful Paint', score: 0.2 },
      'render-blocking-insight': { title: 'Render blocking requests', score: 0 },
      'color-contrast': { title: 'Contrast', score: 0 },
      label: { title: 'Labels', score: 1 },
    },
    ...extra,
  };
}

describe('Lighthouse gate', () => {
  it('passes at exactly 90 and fails at 89 (the bar is 90 or more, both categories)', () => {
    expect(failures([scorePage('/', [lhr(0.9, 0.9)])])).toEqual([]);
    const f = failures([scorePage('/', [lhr(0.89, 0.95)]), scorePage('/menu', [lhr(0.99, 0.89)])]);
    expect(f.map((x) => `${x.page} ${x.result.category} ${x.result.score}`)).toEqual([
      '/ performance 89',
      '/menu accessibility 89',
    ]);
  });

  it('takes the median run by performance (even counts: the lower middle)', () => {
    expect(medianRun([lhr(0.95, 1), lhr(0.7, 1), lhr(0.9, 1)]).categories.performance!.score).toBe(0.9);
    expect(medianRun([lhr(0.95, 1), lhr(0.7, 1)]).categories.performance!.score).toBe(0.7);
  });

  it('an errored run or a missing score counts as 0, so a broken page never passes', () => {
    const broken = scorePage('/sent', [lhr(0.99, 0.99, { runtimeError: { code: 'X', message: 'x' } })]);
    expect(failures([broken])).toHaveLength(2);
    expect(failures([scorePage('/', [lhr(null, 1)])])[0]!.result.score).toBe(0);
  });

  it('names the top 3 audits by weighted cost, then failing unweighted ones', () => {
    expect(topAudits(lhr(0.5, 1), 'performance').map((a) => a.id)).toEqual([
      'largest-contentful-paint', // 25 x 0.6 = 15
      'cumulative-layout-shift', // 25 x 0.5 = 12.5
      'first-contentful-paint', // 10 x 0.8 = 8
    ]);
    expect(topAudits(lhr(0.5, 1), 'performance', 5).map((a) => a.id)).toEqual([
      'largest-contentful-paint',
      'cumulative-layout-shift',
      'first-contentful-paint',
      'render-blocking-insight',
    ]);
  });

  it('the summary lists each failing page with its top audits', () => {
    const md = summary([scorePage('/book/x', [lhr(0.8, 0.85)])]);
    expect(md).toContain('| /book/x | 80 ❌ | 85 ❌ |');
    expect(md).toContain('**/book/x performance 80**');
    expect(md).toContain('`largest-contentful-paint` Largest Contentful Paint (score 40, 4.1 s)');
    expect(md).toContain('`color-contrast` Contrast (score 0)');
  });
});
