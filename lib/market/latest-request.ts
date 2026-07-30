export type LatestRequestGeneration = { current: number };

export type LatestRequestResult<T> =
  | { current: true; value: T }
  | { current: false };

export function invalidateLatestRequest(generation: LatestRequestGeneration) {
  generation.current += 1;
  return generation.current;
}

export function beginLatestRequest(generation: LatestRequestGeneration) {
  return invalidateLatestRequest(generation);
}

export function invokeLatestRequest<T>(latest: { current: () => Promise<T> }) {
  return latest.current();
}

export async function settleLatestRequest<T>(
  generation: LatestRequestGeneration,
  requestId: number,
  operation: () => Promise<T>,
): Promise<LatestRequestResult<T>> {
  try {
    const value = await operation();
    return generation.current === requestId ? { current: true, value } : { current: false };
  } catch (error) {
    if (generation.current !== requestId) return { current: false };
    throw error;
  }
}
