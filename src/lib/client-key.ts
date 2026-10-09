// src/lib/client-key.ts — ENG-01/ENG-14: a guest form's idempotency key belongs to ONE body. A retry of the same
// body after a lost answer keeps its key (the server replays the saved submit); any edit (a corrected email,
// other times) gets a new key, so it is a new submit, never answered as the old one. Browser-safe.
export interface KeyedBody {
  key: string;
  body: string;
}

export function keyFor(
  prev: KeyedBody | null,
  body: unknown,
  fresh: () => string = () => crypto.randomUUID(),
): KeyedBody {
  const s = JSON.stringify(body);
  return prev && prev.body === s ? prev : { key: fresh(), body: s };
}
