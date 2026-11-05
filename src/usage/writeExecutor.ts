/** Bounded FIFO executor; financial callers retain a durable outbox on overflow. */
export class WriteExecutor {
  private running = 0
  private queue: Array<() => void> = []
  constructor(private concurrency: number, private capacity: number) {}
  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency && this.queue.length >= this.capacity) return Promise.reject(new Error('Usage write capacity exhausted'))
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.running++
        void Promise.resolve().then(work).then(resolve, reject).finally(() => {
          this.running--
          this.queue.shift()?.()
        })
      }
      if (this.running < this.concurrency) start()
      else this.queue.push(start)
    })
  }
}
