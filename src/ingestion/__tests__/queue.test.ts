// IngestionQueue is a singleton module. Jest isolates modules per file so
// `ingestionQueue` is a fresh instance for this test file.
import { ingestionQueue } from '../queue';

/** Flush the microtask + macrotask queue so async jobs complete. */
const flush = () => new Promise<void>((r) => setTimeout(r, 10));

describe('IngestionQueue', () => {
  afterEach(() => flush()); // ensure queue drains between tests

  it('pendingCount is 0 before any jobs are enqueued', () => {
    expect(ingestionQueue.pendingCount).toBe(0);
  });

  it('enqueued job is executed', async () => {
    const job = jest.fn().mockResolvedValue(undefined);
    ingestionQueue.enqueue(job);
    await flush();
    expect(job).toHaveBeenCalledTimes(1);
  });

  it('multiple jobs run in order', async () => {
    const order: number[] = [];
    ingestionQueue.enqueue(async () => { order.push(1); });
    ingestionQueue.enqueue(async () => { order.push(2); });
    ingestionQueue.enqueue(async () => { order.push(3); });
    await flush();
    expect(order).toEqual([1, 2, 3]);
  });

  it('failing job does not prevent subsequent jobs from running', async () => {
    const afterFail = jest.fn().mockResolvedValue(undefined);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    ingestionQueue.enqueue(async () => { throw new Error('intentional failure'); });
    ingestionQueue.enqueue(afterFail);
    await flush();
    expect(afterFail).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('onPendingCountChange callback fires when jobs are enqueued and drained', async () => {
    const counts: number[] = [];
    const unsub = ingestionQueue.onPendingCountChange((c) => counts.push(c));
    ingestionQueue.enqueue(jest.fn().mockResolvedValue(undefined));
    await flush();
    unsub();
    // Should have been called at least once (on enqueue and on drain)
    expect(counts.length).toBeGreaterThanOrEqual(1);
  });

  it('unsubscribing removes the listener', () => {
    const cb = jest.fn();
    const unsub = ingestionQueue.onPendingCountChange(cb);
    unsub();
    cb.mockClear();
    // Registering a no-op to trigger _notify without the old cb
    const unsub2 = ingestionQueue.onPendingCountChange(() => {});
    ingestionQueue.enqueue(jest.fn().mockResolvedValue(undefined));
    unsub2();
    expect(cb).not.toHaveBeenCalled();
  });
});
