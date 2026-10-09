// src/features/photos/heic-worker.ts — the HEIC decode runs in a worker thread with a hard deadline.
// heic-decode (libheif-js, WASM) decodes synchronously: in the request's own thread nothing could stop it, and a slow
// file would hold the function past its maxDuration. In a worker it is terminated at the deadline, whatever it is
// doing, and the thread's memory goes with it.
// The decoder is loaded from node_modules (next.config serverExternalPackages), exactly as before.
import 'server-only';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

/**
 * The worker's whole program (CommonJS, run with `eval`): every image in the container is measured before any pixels
 * are decoded (pr38 F1: heic-decode decodes images[0], which needn't be the primary), then images[0] is decoded and
 * its RGBA handed back without a copy. It answers { width, height, data } or { refused }.
 */
const WORKER_SOURCE = `
const { parentPort, workerData: w } = require('node:worker_threads');
const lib = require(w.modulePath);
const heicDecode = lib.default || lib;
const tooBig = (width, height) => !width || !height || width * height > w.maxPixels;
(async () => {
  let images;
  try {
    images = await heicDecode.all({ buffer: Buffer.from(w.buffer) });
  } catch (e) {
    return { refused: 'HEIC unreadable' };
  }
  try {
    if (!images.length || images.some((i) => tooBig(i.width, i.height))) return { refused: 'HEIC too large or unreadable' };
    const { data, width, height } = await images[0].decode();
    if (tooBig(width, height)) return { refused: 'HEIC too large' };
    return { width, height, data };
  } catch (e) {
    return { refused: 'HEIC could not be converted' };
  } finally {
    try { if (images.dispose) images.dispose(); } catch (e) {}
  }
})().then((r) => parentPort.postMessage(r, r.data ? [r.data.buffer] : []));
`;

/** A HEIC the worker refused, or one it couldn't finish in time; the message says which. */
export class HeicRefusedError extends Error {
  override name = 'HeicRefusedError';
}

export interface DecodedHeic {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface HeicWorkerOptions {
  deadlineMs: number;
  maxPixels: number;
  /** the decoder module; default heic-decode from node_modules (tests point it at stand-in decoders) */
  modulePath?: string;
}

function heicDecodePath(): string {
  return createRequire(path.join(process.cwd(), 'package.json')).resolve('heic-decode');
}

/** Decodes the first image of a HEIC in a worker; refuses (HeicRefusedError) on a bad file or at the deadline. */
export function decodeHeicInWorker(buffer: Buffer, opts: HeicWorkerOptions): Promise<DecodedHeic> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { buffer, maxPixels: opts.maxPixels, modulePath: opts.modulePath ?? heicDecodePath() },
    });
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => done(() => reject(new HeicRefusedError('HEIC took too long'))),
      opts.deadlineMs,
    );
    worker.once('message', (m: { refused?: string } & Partial<DecodedHeic>) =>
      done(() =>
        m.refused || !m.data
          ? reject(new HeicRefusedError(m.refused ?? 'HEIC could not be converted'))
          : resolve({ width: m.width!, height: m.height!, data: m.data }),
      ),
    );
    worker.once('error', (e) =>
      done(() => reject(new HeicRefusedError('HEIC could not be converted', { cause: e }))),
    );
    worker.once('exit', () => done(() => reject(new HeicRefusedError('HEIC could not be converted'))));
  });
}
