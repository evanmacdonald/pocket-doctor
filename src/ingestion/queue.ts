// ─── In-Memory Ingestion Queue ───────────────────────────────────────────────
// A simple promise-chained queue that processes one document at a time.
// No external dependencies needed — everything runs in the JS thread.

type Job = () => Promise<void>;

class IngestionQueue {
  private _queue: Job[] = [];
  private _running = false;
  private _listeners: Array<(pending: number) => void> = [];

  enqueue(job: Job) {
    this._queue.push(job);
    this._notify();
    if (!this._running) this._drain();
  }

  get pendingCount() {
    return this._queue.length + (this._running ? 1 : 0);
  }

  onPendingCountChange(cb: (count: number) => void) {
    this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== cb);
    };
  }

  private _notify() {
    for (const cb of this._listeners) cb(this.pendingCount);
  }

  private async _drain() {
    this._running = true;
    while (this._queue.length > 0) {
      const job = this._queue.shift()!;
      this._notify();
      try {
        await job();
      } catch (err) {
        console.error('[IngestionQueue] Job failed:', err);
      }
    }
    this._running = false;
    this._notify();
  }
}

export const ingestionQueue = new IngestionQueue();
