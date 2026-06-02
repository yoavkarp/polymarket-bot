export async function collectPages<T>(
  paginated: AsyncIterable<{ items: T[] }>,
): Promise<T[]> {
  const results: T[] = [];
  for await (const page of paginated) {
    results.push(...page.items);
  }
  return results;
}

export function createRateLimiter(minGapMs: number) {
  let lastCall = 0;
  return async function throttle<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const wait = minGapMs - (now - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return fn();
  };
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
