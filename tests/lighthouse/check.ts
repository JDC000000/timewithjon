// T4.6.04 (+T1.11.U3): read the Lighthouse JSON reports and fail under 90 on performance or accessibility.
// Usage: pnpm exec tsx tests/lighthouse/check.ts <reports-dir>
// <reports-dir>/targets.tsv lists the pages (prepare.ts); page i's runs are <reports-dir>/page-<i>-run-<n>.json.
// Writes the table (and the top 3 audits of anything under the bar) to stdout and $GITHUB_STEP_SUMMARY.
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { failures, MIN_SCORE, scorePage, summary, type Lhr } from './score';

const dir = process.argv[2];
if (!dir) throw new Error('usage: check.ts <reports-dir>');
const pages = readFileSync(path.join(dir, 'targets.tsv'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => line.split('\t')[0]!);
const files = readdirSync(dir);
const results = pages.map((page, i) => {
  const runs = files
    .filter((f) => f.startsWith(`page-${i}-run-`) && f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Lhr);
  if (runs.length === 0) throw new Error(`no Lighthouse report for ${page}`);
  return scorePage(page, runs);
});
const md = summary(results);
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
const under = failures(results);
if (under.length > 0) {
  for (const { page, result } of under) {
    console.log(`::error::${page} ${result.category} ${result.score} (bar ${MIN_SCORE})`);
  }
  process.exit(1);
}
