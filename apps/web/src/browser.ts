import { browser_policy } from '../../../packages/contracts/generated/tracker_contracts.js';
import type { FeedSort, ProblemInput, Profile, SolutionInput } from '@tracker/contracts';

function policy<T>(operation: string, input: unknown): T {
  return JSON.parse(browser_policy(operation, JSON.stringify(input)));
}

export type RequestKind =
  | 'config'
  | 'me'
  | 'demo'
  | 'following'
  | 'notifications'
  | 'markNotification'
  | 'profile'
  | 'saveProfile'
  | 'detail'
  | 'solution'
  | 'saveProblem'
  | 'addSolution'
  | 'reviseSolution'
  | 'participate'
  | 'test'
  | 'comment'
  | 'reopen'
  | 'report'
  | 'deleteImage'
  | 'readImage'
  | 'moderation'
  | 'mergePreview'
  | 'merge'
  | 'moderate';

export type RequestPlan = {
  path: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body: unknown;
};

export const requestPlan = (kind: RequestKind, id?: string, data?: unknown) =>
  policy<RequestPlan>('request', { kind, id, data });

type Feed = {
  sort: FeedSort;
  category: string;
  query: string;
  page: number;
  offset: number;
  path: string;
};
export const feedOptions = (params: URLSearchParams) =>
  policy<Feed>('feed', {
    page: Number(params.get('page')),
    sort: params.get('sort'),
    category: params.get('category'),
    q: params.get('q'),
  });

type ImageOptions = {
  width: number;
  height: number;
  name: string;
  qualities: number[];
  limit: number;
  mime: string;
};
type Result<T> = { error: string; data?: undefined } | { data: T; error?: undefined };
export const imageOptions = (file: File, width?: number, height?: number) =>
  policy<Result<ImageOptions>>('image', {
    mime: file.type,
    name: file.name,
    size: file.size,
    width,
    height,
  });

const form = <T>(kind: string, form: unknown, csv?: string, version?: number) =>
  policy<Result<T>>('form', { kind, form, csv, version });

export const problemSubmission = (input: ProblemInput, tags: string, version?: number) =>
  form<ProblemInput>('problem', input, tags, version);
export const solutionSubmission = (input: SolutionInput) => form<SolutionInput>('solution', input);
type ProfileFields = Pick<Profile, 'displayName' | 'username' | 'bio' | 'expertise'>;
export const profileSubmission = (input: ProfileFields, expertise: string) =>
  form<ProfileFields>('profile', input, expertise);

export const sessionRole = (profile: Pick<Profile, 'role' | 'restricted'> | null) =>
  policy<'guest' | 'member' | 'moderator' | 'restricted'>('role', profile);
export const retryPublic = (
  path: string,
  status: number,
  method: string | undefined,
  hadToken: boolean,
) => policy<boolean>('retryPublic', { path, status, method: method || 'GET', hadToken });
export const modalKey = (
  key: string,
  reverse: boolean,
  count: number,
  index: number,
  contains: boolean,
) =>
  policy<'close' | 'dialog' | 'first' | 'last' | 'default'>('modal', {
    key,
    reverse,
    count,
    index,
    contains,
  });
export const reconcileDraft = <T>(defaults: T, saved: string | null) =>
  policy<T>('draft', { defaults, saved });
export const splitTags = (value: string) => policy<string[]>('csv', value);
export const suggestionPath = (title: string, editing: boolean) =>
  policy<string | null>('suggestion', { title, editing });
export const oauthOptions = (origin: string, provider: string) =>
  policy<{ redirectTo: string; scopes?: string }>('oauth', { origin, provider });
export const screenRoutes = () =>
  policy<
    [
      string,
      (
        | 'feed'
        | 'problem'
        | 'report'
        | 'solution'
        | 'profile'
        | 'following'
        | 'notifications'
        | 'settings'
        | 'moderation'
        | 'auth'
        | 'rules'
        | 'privacy'
      ),
    ][]
  >('routes', null);
