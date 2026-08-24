/**
 * Maps in input order while running at most `concurrency` asynchronous jobs.
 *
 * On the first failure no new jobs are started; already in-flight work is
 * allowed to settle before the original error is rethrown. That keeps an
 * aborted sync pass from leaking RPC work into the next pass.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`concurrency must be a positive integer, got ${concurrency}`);
  }
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let next = 0;
  let failure: unknown;
  let hasFailure = false;

  const run = async (): Promise<void> => {
    while (!hasFailure) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index]!, index);
      } catch (error) {
        failure = error;
        hasFailure = true;
      }
    }
  };

  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => run()));
  if (hasFailure) throw failure;
  return results;
}
