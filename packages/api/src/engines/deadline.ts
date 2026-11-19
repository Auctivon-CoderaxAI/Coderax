/**
 * One deadline for a multi-step startup sequence. A transport call that
 * resolves after the deadline is not allowed to create an untracked session;
 * the caller attaches its own cleanup to the late result.
 */

export type DeadlineOutcome<T> = { ok: true; value: T } | { ok: false };

export function withDeadline<T>(
  promise: Promise<T>,
  deadline: number,
): Promise<DeadlineOutcome<T>> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    // Keep a late rejection from becoming an unhandled rejection.
    void promise.catch(() => undefined);
    return Promise.resolve({ ok: false });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<DeadlineOutcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false }), remaining);
  });
  return Promise.race([
    promise.then((value): DeadlineOutcome<T> => ({ ok: true, value })),
    timedOut,
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}
