/**
 * Utilities for safely handling 64-bit Strava Activity & Athlete identifiers.
 *
 * Strava API consumers must ingest 64-bit identifiers via `id_str` (or lossless JSON
 * integer strings before IEEE-754 float coercion) prior to June 1, 2027.
 */

export function extractStravaId(
  entity: Record<string, any> | null | undefined,
  strField = 'id_str',
  numField = 'id'
): string {
  if (!entity || typeof entity !== 'object') return '';
  const rawStr = entity[strField];
  if (rawStr !== undefined && rawStr !== null && String(rawStr).trim() !== '') {
    return String(rawStr).trim();
  }
  const rawNum = entity[numField];
  if (rawNum !== undefined && rawNum !== null && String(rawNum).trim() !== '') {
    return String(rawNum).trim();
  }
  return '';
}

export function strava64BitJsonReviver(
  _key: string,
  value: any,
  context?: { source?: string }
): any {
  if (
    typeof value === 'number' &&
    !Number.isSafeInteger(value) &&
    typeof context?.source === 'string' &&
    /^-?\d+$/.test(context.source)
  ) {
    return context.source;
  }
  return value;
}

export function parseStravaJson64Safe<T = any>(rawText: string): T {
  return JSON.parse(
    rawText,
    strava64BitJsonReviver as unknown as (this: any, key: string, value: any) => any
  ) as T;
}

export async function readStravaResponseJson<T = any>(resp: {
  text?: () => Promise<string>;
  json: () => Promise<any>;
}): Promise<T> {
  if (typeof resp.text === 'function') {
    const raw = await resp.text();
    if (typeof raw === 'string' && raw.length > 0) {
      return parseStravaJson64Safe<T>(raw);
    }
  }
  return (await resp.json()) as T;
}
