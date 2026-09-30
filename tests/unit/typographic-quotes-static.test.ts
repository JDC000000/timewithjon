// The v1.12 pack sets every apostrophe and quote typographically (’ ‘ “ ”). This test fails on a straight ' or "
// inside any string in src/content (pages, microcopy, emails, ui/*). Keys, imports and type literals aren't copy.
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const K = ts.SyntaxKind;
const PIECES = new Set([
  K.StringLiteral,
  K.NoSubstitutionTemplateLiteral,
  K.TemplateHead,
  K.TemplateMiddle,
  K.TemplateTail,
]);

/** Every copy string with a straight quote, as `file:line: text`. */
function straightQuotes(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: string[] = [];
  const walk = (n: ts.Node): void => {
    if (PIECES.has(n.kind)) {
      const p = n.parent;
      const notCopy =
        (ts.isPropertyAssignment(p) && p.name === n) ||
        ts.isImportDeclaration(p) ||
        ts.isExportDeclaration(p) ||
        ts.isLiteralTypeNode(p);
      const text = (n as ts.LiteralLikeNode).text;
      if (!notCopy && /['"]/.test(text)) {
        hits.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${text}`);
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return hits;
}

describe('typographic quotes in src/content copy', () => {
  const files = globSync('src/content/**/*.ts', { cwd: ROOT }).filter((f) => !f.includes('__tests__'));

  it('scans the copy files', () => {
    const rel = files.map((f) => f.split(path.sep).join('/'));
    expect(rel).toEqual(
      expect.arrayContaining(['src/content/emails.ts', 'src/content/microcopy.ts', 'src/content/site.ts']),
    );
  });

  it('flags a straight apostrophe or quote, in strings and templates, and nothing else', () => {
    const src = [
      `import x from 'y';`,
      `const a = { 'key': "I'll" };`,
      'const b = `say "hi" ${a}`;',
      `const c = 'It’s fine';`,
    ].join('\n');
    expect(straightQuotes('f.ts', src)).toEqual(["f.ts:2: I'll", 'f.ts:3: say "hi" ']);
  });

  it('finds none in src/content', () => {
    expect(files.flatMap((f) => straightQuotes(f, readFileSync(path.join(ROOT, f), 'utf8')))).toEqual([]);
  });
});
