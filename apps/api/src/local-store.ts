import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { prepare_local_commit, valid_snapshot } from '../generated/tracker_core.js';
import { storageResult, type State, type Store } from './state.js';
import { seedState } from './seed.js';

interface FileQueue {
  tail: Promise<unknown>;
  snapshot?: Promise<string>;
}

const openFiles = new Map<string, WeakRef<FileQueue>>();
const cleanup = new FinalizationRegistry<{ path: string; ref: WeakRef<FileQueue> }>(
  ({ path, ref }) => {
    if (openFiles.get(path) === ref) openFiles.delete(path);
  },
);

// Windows readers can briefly prevent atomic file publication while they hold the file open.
export async function publishSnapshot(operation: () => Promise<void>, platform = process.platform) {
  const delays = [5, 10, 25, 50, 100, 200];
  for (let attempt = 0; ; attempt++) {
    try {
      await operation();
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const wait = delays[attempt];
      if (
        platform !== 'win32' ||
        wait === undefined ||
        !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')
      )
        throw error;
      await delay(wait);
    }
  }
}

export class LocalStore implements Store {
  readonly demo = true;
  private file: string;
  private queue: FileQueue;

  constructor(file: string) {
    this.file = resolve(file);
    const existing = openFiles.get(this.file)?.deref();
    this.queue = existing ?? { tail: Promise.resolve() };
    if (!existing) {
      const ref = new WeakRef(this.queue);
      openFiles.set(this.file, ref);
      cleanup.register(this.queue, { path: this.file, ref });
    }
  }

  private async load(): Promise<string> {
    try {
      return await this.readFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const text = JSON.stringify(seedState());
      await this.save(text);
      return text;
    }
  }

  private async readFile() {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
      throw new Error('Demo data could not be read. Preserve the data file before repairing it.', {
        cause: error,
      });
    }
    if (!valid_snapshot(text)) {
      throw new Error('Demo data could not be read. Preserve the data file before repairing it.');
    }
    return text;
  }

  private snapshot() {
    return (this.queue.snapshot ??= this.load().catch((error) => {
      this.queue.snapshot = undefined;
      throw error;
    }));
  }

  private async save(text: string) {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, text, { flag: 'wx', mode: 0o600, flush: true });
      await publishSnapshot(() => rename(temporary, this.file));
    } finally {
      // The target may already be committed. A cleanup failure cannot undo that commit.
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async readJson() {
    await this.queue.tail;
    return this.snapshot();
  }

  async read(): Promise<State> {
    return JSON.parse(await this.readJson());
  }

  command<T>(requestJson: string): Promise<T> {
    return this.mutate((snapshot) =>
      storageResult<{ value: T; snapshot: string }>(prepare_local_commit(snapshot, requestJson)),
    );
  }

  transaction<T>(fn: (state: State) => T): Promise<T> {
    return this.mutate((snapshot) => {
      const next = JSON.parse(snapshot) as State;
      const value = fn(next);
      next.version++;
      return { value, snapshot: JSON.stringify(next) };
    });
  }

  private mutate<T>(prepare: (snapshot: string) => { value: T; snapshot: string }): Promise<T> {
    const operation = this.queue.tail.then(async () => {
      const { value, snapshot } = prepare(await this.snapshot());
      await this.save(snapshot);
      this.queue.snapshot = Promise.resolve(snapshot);
      return value;
    });
    this.queue.tail = operation.catch(() => undefined);
    return operation;
  }
}
