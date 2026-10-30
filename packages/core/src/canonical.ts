// Canonical JSON for document hashing: object keys sorted, no whitespace, undefined dropped.
// Client and server hash the same bytes, so `docSha256` verifies a pushed document end to end.

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : sortKeys(x)));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

/** SHA-256 (lowercase hex) of the canonical JSON, using Web Crypto (browsers and Node 20+). */
export async function docSha256(doc: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(doc));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
