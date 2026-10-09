#!/usr/bin/env node
// scripts/check-heic-shipped.mjs — run after `next build`: every route that converts HEIC ships heic-decode.
// The HEIC decode runs in a worker that loads heic-decode by path (src/features/photos/heic-worker.ts). A hosted
// function holds only the files its build trace (route.js.nft.json) lists, so a decoder the trace misses is simply
// not there, and every HEIC upload fails on the host while passing locally. For each route whose code holds the
// worker, this copies ONLY its traced files into an empty folder, then, from that folder, resolves heic-decode the
// way heic-worker.ts does and decodes a committed HEIC in a worker.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const APP = path.join(ROOT, '.next/server/app');
const MARKER = 'HEIC took too long'; // a string only heic-worker.ts holds
const FIXTURE = path.join(ROOT, 'tests/fixtures/photos/iphone-like.heic');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function traces(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return traces(p);
    return e.name === 'route.js.nft.json' ? [p] : [];
  });
}

/** the route's traced files, as paths relative to the app root */
function tracedFiles(nft) {
  const dir = path.dirname(nft);
  const { files } = JSON.parse(fs.readFileSync(nft, 'utf8'));
  return [
    path.relative(ROOT, path.join(dir, 'route.js')),
    ...files.map((f) => path.relative(ROOT, path.join(dir, f))),
  ];
}

/** copies each traced file (a symlink stays a symlink) into `to`, at its own relative path */
function copyTraced(files, to) {
  for (const rel of files) {
    const from = path.join(ROOT, rel);
    const dest = path.join(to, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const st = fs.lstatSync(from, { throwIfNoEntry: false });
    if (!st || fs.existsSync(dest)) continue;
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), dest);
    else if (st.isFile()) fs.copyFileSync(from, dest);
  }
}

// From the copied folder: heic-worker.ts's resolve, then a decode in a worker (as the worker does).
const PROBE = `
const { createRequire } = require('node:module');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const modulePath = createRequire(path.join(process.cwd(), 'package.json')).resolve('heic-decode');
if (!modulePath.startsWith(process.cwd() + path.sep)) throw new Error('heic-decode resolved outside the copy: ' + modulePath);
const w = new Worker(\`
  const { parentPort, workerData: w } = require('node:worker_threads');
  const lib = require(w.modulePath);
  (lib.default || lib).all({ buffer: Buffer.from(w.buffer) })
    .then((images) => images[0].decode())
    .then(({ width, height }) => parentPort.postMessage({ width, height }), (e) => parentPort.postMessage({ error: String(e) }));
\`, { eval: true, workerData: { modulePath, buffer: require('node:fs').readFileSync(process.argv[1]) } });
w.once('message', (m) => { console.log(JSON.stringify(m)); process.exit(m.error ? 1 : 0); });
w.once('error', (e) => { console.log(JSON.stringify({ error: String(e) })); process.exit(1); });
`;

if (!fs.existsSync(APP)) fail('no build output: run `next build` first');
const routes = traces(APP).filter((nft) =>
  tracedFiles(nft).some(
    (rel) =>
      rel.startsWith('.next/server/chunks/') &&
      rel.endsWith('.js') &&
      fs.readFileSync(rel, 'utf8').includes(MARKER),
  ),
);
if (routes.length === 0) fail(`no route holds the HEIC worker (the marker "${MARKER}" moved?)`);

let failed = 0;
for (const nft of routes) {
  const route = path.relative(APP, path.dirname(nft));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heic-shipped-'));
  try {
    copyTraced(tracedFiles(nft), tmp);
    const r = spawnSync(process.execPath, ['-e', PROBE, FIXTURE], {
      cwd: tmp,
      encoding: 'utf8',
      timeout: 60_000,
    });
    const out = `${r.stdout}${r.stderr}`.trim();
    if (r.status === 0) console.log(`ok /${route}: decoded from its traced files ${out}`);
    else {
      failed++;
      console.error(`FAIL: /${route}: HEIC can't be decoded from its traced files: ${out}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
if (failed) process.exit(1);
