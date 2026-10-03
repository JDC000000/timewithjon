// T4.6.04 (+T1.11.U3): the pure part of the Lighthouse gate. Reads Lighthouse JSON reports (LHR), picks the median
// run per page and says which pages score under the bar, with the audits that pull each failing score down most.

export const CATEGORIES = ['performance', 'accessibility'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * T1.11 AC1 / T4.6.04 (mobile). Accessibility stays at 90. Performance is 85 for now (Jon, 2026-10-03: the gate blocks
 * from today so nothing regresses); it goes back to 90 when the below-the-fold photo quality change lands.
 */
export const MIN_SCORE: Record<Category, number> = { performance: 85, accessibility: 90 };

/** The slice of a Lighthouse report this gate reads. */
export type Lhr = {
  requestedUrl?: string;
  runtimeError?: { code: string; message: string };
  categories: Partial<
    Record<Category, { score: number | null; auditRefs: { id: string; weight: number }[] }>
  >;
  audits: Record<string, { title: string; score: number | null; displayValue?: string }>;
};

export type Audit = { id: string; title: string; score: number; displayValue?: string };
export type CategoryResult = { category: Category; score: number; top: Audit[] };
export type PageResult = { page: string; runs: number; results: CategoryResult[] };

/** A 0–1 category score as the 0–100 Lighthouse shows; a missing score (errored run) counts as 0. */
export function toPercent(score: number | null | undefined): number {
  return Math.round((score ?? 0) * 100);
}

/**
 * The top `n` audits costing a category the most: weighted audits first (weight x missed score), then the
 * unweighted ones that still fail (Lighthouse's insights/diagnostics), lowest score first.
 */
export function topAudits(lhr: Lhr, category: Category, n = 3): Audit[] {
  const refs = lhr.categories[category]?.auditRefs ?? [];
  const failing = refs
    .map((ref) => ({ ref, audit: lhr.audits[ref.id] }))
    .filter((x) => x.audit && x.audit.score !== null && x.audit.score < 0.9);
  const cost = (x: (typeof failing)[number]) => x.ref.weight * (1 - (x.audit!.score ?? 0));
  const weighted = failing.filter((x) => x.ref.weight > 0).sort((a, b) => cost(b) - cost(a));
  const rest = failing
    .filter((x) => x.ref.weight === 0)
    .sort((a, b) => (a.audit!.score ?? 0) - (b.audit!.score ?? 0));
  return [...weighted, ...rest].slice(0, n).map(({ ref, audit }) => ({
    id: ref.id,
    title: audit!.title,
    score: toPercent(audit!.score),
    ...(audit!.displayValue ? { displayValue: audit!.displayValue } : {}),
  }));
}

/** The median run by performance score (odd counts: the middle one; even: the lower middle, the stricter pick). */
export function medianRun(runs: Lhr[]): Lhr {
  if (runs.length === 0) throw new Error('no Lighthouse runs');
  const sorted = [...runs].sort(
    (a, b) => toPercent(a.categories.performance?.score) - toPercent(b.categories.performance?.score),
  );
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/** One page's verdict from its runs. An errored run scores 0, so a broken page never passes. */
export function scorePage(page: string, runs: Lhr[]): PageResult {
  const run = medianRun(runs);
  return {
    page,
    runs: runs.length,
    results: CATEGORIES.map((category) => ({
      category,
      score: run.runtimeError ? 0 : toPercent(run.categories[category]?.score),
      top: topAudits(run, category),
    })),
  };
}

/** Every page/category under the bar. */
export function failures(pages: PageResult[]): { page: string; result: CategoryResult }[] {
  return pages.flatMap((p) =>
    p.results.filter((r) => r.score < MIN_SCORE[r.category]).map((result) => ({ page: p.page, result })),
  );
}

/** The Markdown table (+ follow-ups for anything under the bar) for the job summary and the PR body. */
export function summary(pages: PageResult[]): string {
  const lines = [
    `### Lighthouse mobile (bar: performance ${MIN_SCORE.performance}, accessibility ${MIN_SCORE.accessibility}, or more; median of each page's runs)`,
    '',
    '| Page | Performance | Accessibility |',
    '| --- | --- | --- |',
    ...pages.map((p) => {
      const cell = (c: Category) => {
        const s = p.results.find((r) => r.category === c)!.score;
        return `${s}${s < MIN_SCORE[c] ? ' ❌' : ''}`;
      };
      return `| ${p.page} | ${cell('performance')} | ${cell('accessibility')} |`;
    }),
  ];
  for (const { page, result } of failures(pages)) {
    lines.push('', `**${page} ${result.category} ${result.score}**: top audits`);
    for (const a of result.top) {
      lines.push(`- \`${a.id}\` ${a.title} (score ${a.score}${a.displayValue ? `, ${a.displayValue}` : ''})`);
    }
  }
  return lines.join('\n') + '\n';
}
