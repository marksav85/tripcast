import { ApiError } from './errors.js';

export const WEATHER_LIMITS = Object.freeze({ operations: 11, attempts: 24, concurrent: 2, deadlineMs: 30000 });
const cancelled = () => new ApiError('REQUEST_CANCELLED', 499, 'Weather request was cancelled.');

// Race settlement as well as signalling the actual fetch/body/sleep being cancelled.
export async function abortable(signal, work) {
  if (!signal) return work();
  signal.throwIfAborted();
  let onAbort;
  const stopped = new Promise((resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }), stopped]);
  } finally { signal.removeEventListener('abort', onAbort); }
}

/** One aggregate request owns this context. Dispose in its finally block. */
export function createWeatherContext({ signal, now = () => Date.now() } = {}) {
  const controller = new AbortController();
  const deadline = now() + WEATHER_LIMITS.deadlineMs;
  let operations = 0; let attempts = 0; let active = 0;
  const waiters = new Set();
  const expire = () => controller.abort(new ApiError('REQUEST_DEADLINE', 504, 'Weather request deadline was exceeded.'));
  const cancel = () => controller.abort(cancelled());
  const timer = setTimeout(expire, WEATHER_LIMITS.deadlineMs);
  const parentAbort = () => { cancel(); clearTimeout(timer); };
  if (signal?.aborted) parentAbort(); else signal?.addEventListener('abort', parentAbort, { once: true });
  function check() {
    if (!controller.signal.aborted && now() >= deadline) expire();
    controller.signal.throwIfAborted();
  }
  return {
    signal: controller.signal,
    remaining() { check(); return Math.max(0, deadline - now()); },
    check,
    beginOperation() {
      check();
      if (operations >= WEATHER_LIMITS.operations) throw new ApiError('COLLECTOR_BUDGET_EXHAUSTED', 503, 'Weather collector budget was exhausted.');
      operations += 1;
    },
    startAttempt() {
      check();
      if (attempts >= WEATHER_LIMITS.attempts) throw new ApiError('REQUEST_BUDGET_EXHAUSTED', 503, 'Weather request budget was exhausted.');
      attempts += 1;
    },
    async acquire(signal = controller.signal) {
      signal = AbortSignal.any([controller.signal, signal]);
      check(); signal.throwIfAborted();
      // At most eleven admitted operations can wait; this is only an HTTP semaphore.
      while (active >= WEATHER_LIMITS.concurrent) {
        let wake;
        try {
          await abortable(signal, () => new Promise(resolve => { wake = resolve; waiters.add(wake); }));
        } finally { waiters.delete(wake); }
        check(); signal.throwIfAborted();
      }
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true; active -= 1;
        for (const wake of waiters) wake();
        waiters.clear();
      };
    },
    get usage() { return { operations, attempts, active, queued: waiters.size }; },
    dispose() {
      cancel(); clearTimeout(timer); signal?.removeEventListener('abort', parentAbort);
    },
  };
}
