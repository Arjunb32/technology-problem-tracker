import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { State, Store } from './state.js';
import { seedState } from './seed.js';

export class LocalStore implements Store {
  readonly demo = true;
  private tail: Promise<unknown> = Promise.resolve();
  private state: State | null = null;
  constructor(private file: string) {}
  private async load() {
    if (this.state) return;
    try {
      this.state = JSON.parse(await readFile(this.file, 'utf8')) as State;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          'Demo data could not be read. Preserve the data file before repairing it.',
          { cause: error },
        );
      this.state = seedState();
      await this.save(this.state);
    }
  }
  private async save(state: State) {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
    await rename(tmp, this.file);
  }
  async read() {
    await this.tail;
    await this.load();
    return structuredClone(this.state!);
  }
  transaction<T>(fn: (state: State) => T): Promise<T> {
    const operation = this.tail.then(async () => {
      await this.load();
      const next = structuredClone(this.state!);
      const result = fn(next);
      next.version++;
      await this.save(next);
      this.state = next;
      return result;
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
}
