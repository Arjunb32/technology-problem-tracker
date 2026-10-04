import type {
  Profile,
  Problem,
  SolutionRevision,
  SolutionTest,
  Verification,
  Comment,
  TimelineEvent,
  ModerationReport,
  AuditEvent,
  Notification,
  Attachment,
} from '@tracker/contracts';

export type StoredProblem = Omit<
  Problem,
  | 'author'
  | 'affectedCount'
  | 'voteCount'
  | 'followerCount'
  | 'solutionCount'
  | 'verifiedCount'
  | 'recentAffectedCount'
  | 'recentVoteCount'
  | 'viewer'
  | 'attachments'
>;
export interface StoredSolution {
  id: string;
  problemId: string;
  authorId: string;
  hidden: boolean;
  demo: boolean;
  createdAt: string;
  updatedAt: string;
}
export type StoredRevision = Omit<SolutionRevision, 'tests' | 'verification'> & {
  solutionId: string;
};
export type StoredVerification = Verification & { revisionId: string };
export type StoredComment = Omit<Comment, 'author'>;
export interface Participation {
  id: string;
  problemId: string;
  userId: string;
  kind: 'affected' | 'vote' | 'follow';
  setup: string;
  createdAt: string;
}
export type StoredAttachment = Attachment & { data?: string; storagePath?: string };
export interface RateLimit {
  id: string;
  userId: string;
  window: number;
  count: number;
}
export interface State {
  version: number;
  profiles: Profile[];
  problems: StoredProblem[];
  participation: Participation[];
  solutions: StoredSolution[];
  revisions: StoredRevision[];
  tests: SolutionTest[];
  verifications: StoredVerification[];
  comments: StoredComment[];
  timeline: TimelineEvent[];
  reports: ModerationReport[];
  audit: AuditEvent[];
  notifications: Notification[];
  attachments: StoredAttachment[];
  limits: RateLimit[];
}
export const collections = [
  'profiles',
  'problems',
  'participation',
  'solutions',
  'revisions',
  'tests',
  'verifications',
  'comments',
  'timeline',
  'reports',
  'audit',
  'notifications',
  'attachments',
  'limits',
] as const;
export type Collection = (typeof collections)[number];
export function emptyState(): State {
  return Object.fromEntries([
    ['version', 0],
    ...collections.map((k) => [k, []]),
  ]) as unknown as State;
}
export interface Store {
  demo: boolean;
  read(problemId?: string): Promise<State>;
  transaction<T>(fn: (state: State) => T): Promise<T>;
  search?(query: string): Promise<string[]>;
  putImage?(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  getImage?(path: string): Promise<Uint8Array>;
  removeImage?(path: string): Promise<void>;
  profile?(userId: string): Promise<Profile | null>;
}
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new ApiFailure(status, code, message);
}
export function now() {
  return new Date().toISOString();
}
export function id() {
  return crypto.randomUUID();
}
export function isModerator(p: Profile | null | undefined) {
  return !!p && !p.restricted && (p.role === 'moderator' || p.role === 'admin');
}
