// Shared helpers for external media sources (NASA Image Library, Wikimedia Commons):
// a session cache with expiry, shared in-flight requests, and a fetch wrapper with typed errors.
const TTL_FOUND = 30 * 60 * 1000;
const TTL_EMPTY = 2 * 60 * 1000; // empty results are re-checked soon; failures are never cached
const memory = new Map();
const inflight = new Map();

export class MediaError extends Error {
  constructor(kind, message, status) { super(message); this.kind = kind; this.status = status; } // kind: network | timeout | http | invalid
}
export const normalize = text => String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const session = {
  read: key => { try { return JSON.parse(sessionStorage.getItem('fa3:' + key)); } catch { return null; } },
  write: (key, entry) => { try { sessionStorage.setItem('fa3:' + key, JSON.stringify(entry)); } catch { /* storage full: memory only */ } }
};
const isEmptyValue = value => value == null || (Array.isArray(value) && value.length === 0);

/** Returns the cached value for `key`, or runs `load` once (concurrent callers share the same promise). Rejections are not cached. */
export function cached(key, load) {
  const entry = memory.get(key) || session.read(key);
  if (entry && Date.now() - entry.savedAt < entry.ttl) { memory.set(key, entry); return Promise.resolve(entry.value); }
  if (inflight.has(key)) return inflight.get(key);
  const request = (async () => {
    const value = await load();
    const saved = { savedAt: Date.now(), ttl: isEmptyValue(value) ? TTL_EMPTY : TTL_FOUND, value };
    memory.set(key, saved); session.write(key, saved);
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

export async function fetchJson(url, sourceName, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try { response = await fetch(url, { signal: controller.signal }); }
  catch { throw controller.signal.aborted ? new MediaError('timeout', `${sourceName} took too long to respond.`) : new MediaError('network', `Could not reach ${sourceName}.`); }
  finally { clearTimeout(timer); }
  if (!response.ok) throw new MediaError('http', `${sourceName} returned HTTP ${response.status}.`, response.status);
  try { return await response.json(); } catch { throw new MediaError('invalid', `${sourceName} returned invalid JSON.`); }
}
