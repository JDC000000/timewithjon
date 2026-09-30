// Serves the v1.12 design pack (designs/) for the T4.3.09 cases in `E2E_TARGET=pack` mode (local only: the pack
// is not in the repo). E2E_PACK_FAULT=<name> injects one named fault from pack-faults.mjs into every HTML page, to
// prove a case goes red when the behaviour it guards is broken. Usage: node pack-server.mjs <dir> <port>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { PACK_FAULTS } from './pack-faults.mjs';

const [dir, port] = process.argv.slice(2);
if (!dir || !port) throw new Error('usage: node pack-server.mjs <pack dir> <port>');
const root = resolve(dir);
const faultName = process.env.E2E_PACK_FAULT ?? '';
const fault = faultName ? PACK_FAULTS[faultName] : undefined;
if (faultName && !fault) throw new Error(`unknown E2E_PACK_FAULT "${faultName}"`);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
};

// The fault's script runs first (top of <head>, before the pack's own scripts); its style comes last (end of <body>).
function withFault(html) {
  if (!fault) return html;
  const withScript = fault.js ? html.replace('<head>', `<head><script>${fault.js}</script>`) : html;
  return fault.css ? withScript.replace('</body>', `<style>${fault.css}</style></body>`) : withScript;
}

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(type.startsWith('text/html') ? withFault(body.toString('utf8')) : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(Number(port), '127.0.0.1');
