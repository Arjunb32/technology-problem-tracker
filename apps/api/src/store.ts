import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiFailure, storageResult, type State, type Store } from './state.js';
import { commit_decision, prepare_commit, snapshot_delta } from '../generated/tracker_core.js';
import type { FeedResult, FeedSort } from '@tracker/contracts';

export interface FeedQuery {
  sort: FeedSort;
  category?: string;
  q?: string;
  viewerId?: string;
  offset?: number;
}
export interface ProductionStore extends Store {
  feed(query: FeedQuery): Promise<FeedResult>;
}
interface Commit {
  p_expected: number;
  p_changes: Record<string, { upsert: unknown[]; remove: string[] }>;
}

export class SupabaseStore implements ProductionStore {
  readonly demo = false;
  readonly client: SupabaseClient;
  constructor(
    private url: string,
    private key: string,
    private fetcher: typeof fetch = fetch,
  ) {
    this.client = createClient(url, key, {
      global: { fetch: fetcher },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  async profile(userId: string) {
    const { data, error } = await this.client
      .from('profiles')
      .select('payload')
      .eq('id', userId)
      .maybeSingle();
    if (error)
      throw new ApiFailure(503, 'database_unavailable', 'Your profile is temporarily unavailable.');
    return data?.payload ?? null;
  }
  async readJson(problemId?: string): Promise<string> {
    // Forward the PostgREST response straight to the Rust JSON reader.
    try {
      const response = await this.fetcher(
        this.url.replace(/\/$/, '') + '/rest/v1/rpc/tracker_snapshot',
        {
          method: 'POST',
          redirect: 'error',
          headers: {
            apikey: this.key,
            Authorization: 'Bearer ' + this.key,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ p_problem_id: problemId ?? null }),
        },
      );
      if (response.ok) return await response.text();
    } catch {}
    throw new ApiFailure(
      503,
      'database_unavailable',
      'The database is unavailable. Please try again.',
    );
  }
  async read(problemId?: string): Promise<State> {
    const snapshot = await this.readJson(problemId);
    try {
      return JSON.parse(snapshot) as State;
    } catch {
      throw new ApiFailure(
        503,
        'database_unavailable',
        'The database is unavailable. Please try again.',
      );
    }
  }

  command<T>(requestJson: string): Promise<T> {
    return this.commit((snapshot) =>
      storageResult<{ value: T; commit: Commit }>(prepare_commit(snapshot, requestJson)),
    );
  }

  transaction<T>(fn: (state: State) => T): Promise<T> {
    return this.commit((snapshot) => {
      const next = JSON.parse(snapshot) as State;
      const value = fn(next);
      const { commit } = storageResult<{ commit: Commit }>(
        snapshot_delta(snapshot, JSON.stringify(next)),
      );
      return { value, commit };
    });
  }

  private async commit<T>(prepare: (snapshot: string) => { value: T; commit: Commit }): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const { value, commit } = prepare(await this.readJson());
      const { data, error } = await this.client.rpc('tracker_commit', commit);
      const errorCode = error
        ? (error.code ?? '')
        : data === false || data === true
          ? undefined
          : '';
      const decision = storageResult<'committed' | 'retry'>(
        commit_decision(attempt, data === true, errorCode),
      );
      if (decision === 'committed') return value;
    }
  }
  async search(query: string): Promise<string[]> {
    const { data, error } = await this.client.rpc('tracker_search', { p_query: query });
    if (error)
      throw new ApiFailure(503, 'search_unavailable', 'Search is temporarily unavailable.');
    return (data as Array<{ id: string }>).map((x) => x.id);
  }
  async feed(query: FeedQuery): Promise<FeedResult> {
    const { data, error } = await this.client.rpc('tracker_feed', {
      p_sort: query.sort,
      p_category: query.category ?? null,
      p_query: query.q ?? null,
      p_viewer: query.viewerId ?? null,
      p_offset: query.offset ?? 0,
    });
    if (error)
      throw new ApiFailure(
        503,
        'database_unavailable',
        'The problem feed is temporarily unavailable.',
      );
    return data as FeedResult;
  }
  async putImage(path: string, bytes: Uint8Array, mime: string) {
    const { error } = await this.client.storage
      .from('tracker-images')
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (error) throw new ApiFailure(503, 'upload_failed', 'Your image could not be saved.');
  }
  async getImage(path: string) {
    const { data, error } = await this.client.storage.from('tracker-images').download(path);
    if (error || !data) throw new ApiFailure(404, 'not_found', 'Image not found.');
    return new Uint8Array(await data.arrayBuffer());
  }
  async removeImage(path: string) {
    const { error } = await this.client.storage.from('tracker-images').remove([path]);
    if (error)
      throw new ApiFailure(503, 'storage_unavailable', 'Image could not be deleted. Please retry.');
  }
}
