import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiFailure, collections, type State, type Store } from './state.js';
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
export class SupabaseStore implements ProductionStore {
  readonly demo = false;
  readonly client: SupabaseClient;
  constructor(url: string, key: string) {
    this.client = createClient(url, key, {
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
  async read(problemId?: string): Promise<State> {
    const { data, error } = await this.client.rpc('tracker_snapshot', {
      p_problem_id: problemId ?? null,
    });
    if (error)
      throw new ApiFailure(
        503,
        'database_unavailable',
        'The database is unavailable. Please try again.',
      );
    return data as State;
  }
  async transaction<T>(fn: (state: State) => T): Promise<T> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const old = await this.read();
      const next = structuredClone(old);
      const result = fn(next);
      const changes: Record<string, { upsert: unknown[]; remove: string[] }> = {};
      for (const key of collections) {
        const before = new Map(
          (old[key] as Array<{ id: string }>).map((row) => [row.id, JSON.stringify(row)]),
        );
        const after = next[key] as Array<{ id: string }>;
        const upsert = after.filter((row) => before.get(row.id) !== JSON.stringify(row));
        const ids = new Set(after.map((row) => row.id));
        const remove = [...before.keys()].filter((key) => !ids.has(key));
        if (upsert.length || remove.length) changes[key] = { upsert, remove };
      }
      const { data, error } = await this.client.rpc('tracker_commit', {
        p_expected: old.version,
        p_changes: changes,
      });
      if (error) {
        if (error.code === '23505')
          throw new ApiFailure(409, 'conflict', 'That value is already in use.');
        throw new ApiFailure(
          503,
          'database_unavailable',
          'Your changes could not be saved. Please try again.',
        );
      }
      if (data === true) return result;
    }
    throw new ApiFailure(
      409,
      'concurrent_update',
      'This content changed while you were editing. Reload and try again.',
    );
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
