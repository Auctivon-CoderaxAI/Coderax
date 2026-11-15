/**
 * Cooldowns for provider endpoints.
 *
 * A failed endpoint is retried only after its cooldown expires, so a provider
 * outage cannot burn the rest of the free budget in the same minute. Health is
 * process-local and injected, not a module singleton.
 */

export type EndpointHealthSnapshot = {
  available: boolean;
  failures: number;
  cooldownUntil: number | null;
  lastErrorCode: string | null;
};

type HealthEntry = {
  failures: number;
  cooldownUntil: number;
  lastErrorCode: string | null;
};

export type EndpointHealth = {
  isAvailable: (id: string) => boolean;
  recordFailure: (id: string, code: string) => void;
  recordSuccess: (id: string) => void;
  snapshot: (id: string) => EndpointHealthSnapshot;
};

export function createEndpointHealth({
  cooldownMs,
  failureThreshold = 2,
  now = Date.now,
}: {
  cooldownMs: number;
  failureThreshold?: number;
  now?: () => number;
}): EndpointHealth {
  const entries = new Map<string, HealthEntry>();

  function read(id: string): HealthEntry {
    return entries.get(id) ?? { failures: 0, cooldownUntil: 0, lastErrorCode: null };
  }

  return {
    isAvailable(id) {
      const entry = read(id);
      return now() >= entry.cooldownUntil;
    },
    recordFailure(id, code) {
      const current = read(id);
      const failures = current.failures + 1;
      const cooling = failures >= failureThreshold;
      entries.set(id, {
        failures: cooling ? 0 : failures,
        cooldownUntil: cooling ? now() + cooldownMs : current.cooldownUntil,
        lastErrorCode: code,
      });
    },
    recordSuccess(id) {
      entries.set(id, { failures: 0, cooldownUntil: 0, lastErrorCode: null });
    },
    snapshot(id) {
      const entry = read(id);
      const until = entry.cooldownUntil > 0 ? entry.cooldownUntil : null;
      return {
        available: now() >= entry.cooldownUntil,
        failures: entry.failures,
        cooldownUntil: until,
        lastErrorCode: entry.lastErrorCode,
      };
    },
  };
}
