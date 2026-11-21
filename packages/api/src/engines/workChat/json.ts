export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
