import { validate, test_stats } from '../generated/tracker_contracts.js';
export { default as initContracts } from '../generated/tracker_contracts.js';

export const categories = ['Computers', 'Software', 'Networking'] as const;
export const statuses = [
  'Reported',
  'Needs information',
  'Confirmed',
  'Investigating',
  'Partially solved',
  'Resolved',
  'Reopened',
  'Duplicate',
  'Closed',
] as const;
export const outcomes = ['Worked', 'Did not work', 'Partially worked', 'Not applicable'] as const;
export const providers = ['google', 'github', 'azure'] as const;
export type Category = (typeof categories)[number];
export type ProblemStatus = (typeof statuses)[number];
export type TestOutcome = (typeof outcomes)[number];
export type Role = 'member' | 'moderator' | 'admin';
export type FeedSort = 'trending' | 'affected' | 'unsolved' | 'solved' | 'new';
export type TargetType = 'problem' | 'solution' | 'comment' | 'profile';

export interface Profile {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  expertise: string[];
  avatarUrl?: string;
  role: Role;
  restricted: boolean;
  createdAt: string;
}
export type PublicProfile = Omit<Profile, 'restricted'>;
export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  targetType: 'problem' | 'solution';
  targetId: string;
  ownerId: string;
}
export interface Problem {
  id: string;
  authorId: string;
  author: PublicProfile;
  title: string;
  description: string;
  category: Category;
  product: string;
  classification: 'Hardware' | 'Software' | 'Both';
  setup: string;
  symptoms: string;
  steps: string;
  attemptedFixes: string;
  tags: string[];
  status: ProblemStatus;
  canonicalId: string | null;
  hidden: boolean;
  demo: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  version: number;
  affectedCount: number;
  voteCount: number;
  followerCount: number;
  solutionCount: number;
  verifiedCount: number;
  recentAffectedCount: number;
  recentVoteCount: number;
  viewer: { affected: boolean; voted: boolean; following: boolean; setup: string };
  attachments: Attachment[];
}
export interface Verification {
  id: string;
  reviewerId: string;
  evidence: string;
  supportedScope: string;
  reason: string;
  decision: 'verified' | 'revoked';
  createdAt: string;
}
export interface SolutionTest {
  id: string;
  userId: string;
  revisionId: string;
  outcome: TestOutcome;
  setup: string;
  evidence: string;
  createdAt: string;
  updatedAt: string;
}
export interface SolutionRevision {
  id: string;
  number: number;
  title: string;
  instructions: string;
  reasoning: string;
  supportedSetup: string;
  limitations: string;
  warnings: string;
  createdAt: string;
  tests: SolutionTest[];
  verification: Verification | null;
}
export interface Solution {
  id: string;
  problemId: string;
  authorId: string;
  author: PublicProfile;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
  demo: boolean;
  currentRevision: SolutionRevision;
  revisions: SolutionRevision[];
  attachments: Attachment[];
}
export interface Comment {
  id: string;
  problemId: string;
  authorId: string;
  author: PublicProfile;
  body: string;
  hidden: boolean;
  createdAt: string;
}
export interface TimelineEvent {
  id: string;
  problemId: string;
  actorId: string | null;
  kind: string;
  fromStatus: ProblemStatus | null;
  toStatus: ProblemStatus | null;
  reason: string;
  createdAt: string;
}
export interface ProblemDetail {
  problem: Problem;
  solutions: Solution[];
  comments: Comment[];
  timeline: TimelineEvent[];
  related: Problem[];
  redirectId?: string;
}
export interface FeedResult {
  items: Problem[];
  total: number;
}
export interface Notification {
  id: string;
  userId: string;
  problemId: string | null;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}
export interface ModerationReport {
  id: string;
  reporterId: string;
  targetType: TargetType;
  targetId: string;
  reason: string;
  details: string;
  state: 'open' | 'resolved';
  createdAt: string;
}
export interface AuditEvent {
  id: string;
  actorId: string;
  action: string;
  targetId: string;
  reason: string;
  createdAt: string;
}
export interface ModerationData {
  reports: ModerationReport[];
  verificationQueue: Solution[];
  profiles: Profile[];
  audit: AuditEvent[];
  problems: Problem[];
  solutions: Solution[];
  comments: Comment[];
}
export interface MergePreview {
  source: Problem;
  target: Problem;
  affectedBefore: number;
  affectedAfter: number;
  votesBefore: number;
  votesAfter: number;
  followersBefore: number;
  followersAfter: number;
}
export interface AppConfig {
  demo: boolean;
  configuredAuth: boolean;
  providers: (typeof providers)[number][];
  demoAccounts: Profile[];
}
export interface ApiError {
  error: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

export type ProblemInput = Pick<
  Problem,
  'title' | 'description' | 'category' | 'product' | 'classification'
> &
  Partial<Pick<Problem, 'setup' | 'symptoms' | 'steps' | 'attemptedFixes' | 'tags' | 'version'>> & {
    affected?: boolean;
  };
export type SolutionInput = Pick<SolutionRevision, 'title' | 'instructions' | 'supportedSetup'> &
  Partial<Pick<SolutionRevision, 'reasoning' | 'limitations' | 'warnings'>>;
export type Issue = { code: string; path: (string | number)[]; message: string };
export class ContractError extends Error {
  constructor(public issues: Issue[]) {
    super(issues[0]?.message ?? 'Check the form fields.');
  }
}
export function schema<T>(name: string) {
  const safeParse = (
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: Issue[] } } =>
    JSON.parse(validate(name, JSON.stringify(value) ?? ''));
  return {
    safeParse,
    parse(value: unknown) {
      const result = safeParse(value);
      if (!result.success) throw new ContractError(result.error.issues);
      return result.data;
    },
  };
}
export const problemInputSchema = schema<ProblemInput>('problem'),
  solutionInputSchema = schema<SolutionInput>('solution');
export const profileSchema =
  schema<Pick<Profile, 'username' | 'displayName' | 'bio' | 'expertise'>>('profile');
export const participationSchema = schema('participation'),
  solutionTestSchema = schema('test'),
  verificationSchema = schema('verify'),
  statusChangeSchema = schema('status'),
  reportSchema = schema('report');
export const commentSchema = schema('comment'),
  hideSchema = schema('hide'),
  restrictSchema = schema('restrict'),
  mergeSchema = schema('merge'),
  reasonSchema = schema('reason');
export const readSchema = schema('read'),
  demoSchema = schema<{ userId: string }>('demo');
export function testStats(tests: SolutionTest[]): {
  counts: Record<TestOutcome, number>;
  applicable: number;
  successRate: number | null;
} {
  return JSON.parse(test_stats(JSON.stringify(tests)));
}
