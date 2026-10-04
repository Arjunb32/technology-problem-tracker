import { z } from 'zod';

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

const shortText = z.string().trim().max(300);
const bodyText = z.string().trim().max(12000);
export const problemInputSchema = z
  .object({
    title: z.string().trim().min(10, 'Use at least 10 characters for the title.').max(180),
    description: bodyText.min(30, 'Add at least 30 characters describing the issue.'),
    category: z.enum(categories),
    product: shortText.min(2),
    classification: z.enum(['Hardware', 'Software', 'Both']),
    setup: z.string().trim().max(2000).default(''),
    symptoms: bodyText.default(''),
    steps: bodyText.default(''),
    attemptedFixes: bodyText.default(''),
    tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
    affected: z.boolean().default(true),
    version: z.number().int().positive().optional(),
  })
  .strict();
export type ProblemInput = z.input<typeof problemInputSchema>;
export const solutionInputSchema = z
  .object({
    title: z.string().trim().min(5).max(180),
    instructions: bodyText.min(20),
    reasoning: bodyText.default(''),
    supportedSetup: z.string().trim().min(3).max(2000),
    limitations: bodyText.default(''),
    warnings: bodyText.default(''),
  })
  .strict();
export type SolutionInput = z.input<typeof solutionInputSchema>;
export const participationSchema = z
  .object({
    kind: z.enum(['affected', 'vote', 'follow']),
    active: z.boolean(),
    setup: z.string().trim().max(2000).default(''),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.kind === 'affected' && v.active && v.setup.length < 3)
      c.addIssue({
        code: 'custom',
        path: ['setup'],
        message: 'Describe the setup where you experience this issue.',
      });
  });
export const solutionTestSchema = z
  .object({
    revisionId: z.string().min(1),
    outcome: z.enum(outcomes),
    setup: z.string().trim().min(3).max(2000),
    evidence: bodyText.default(''),
  })
  .strict();
export const verificationSchema = z
  .object({
    revisionId: z.string().min(1),
    evidence: z.string().trim().min(10).max(12000),
    supportedScope: z.string().trim().min(3).max(2000),
    reason: z.string().trim().min(10).max(2000),
    decision: z.enum(['verified', 'revoked']),
  })
  .strict();
export const statusChangeSchema = z
  .object({ status: z.enum(statuses), reason: z.string().trim().min(10).max(2000) })
  .strict();
export const reportSchema = z
  .object({
    targetType: z.enum(['problem', 'solution', 'comment', 'profile']),
    targetId: z.string().min(1),
    reason: z.string().trim().min(3).max(100),
    details: z.string().trim().min(10).max(4000),
  })
  .strict();
export const profileSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80),
    username: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]{3,30}$/),
    bio: z.string().trim().max(600),
    expertise: z.array(z.string().trim().min(1).max(40)).max(8),
  })
  .strict();
export function testStats(tests: SolutionTest[]) {
  const counts = Object.fromEntries(
    outcomes.map((o) => [o, tests.filter((t) => t.outcome === o).length]),
  ) as Record<TestOutcome, number>;
  const applicable = tests.length - counts['Not applicable'];
  return {
    counts,
    applicable,
    successRate: applicable ? Math.round((counts.Worked / applicable) * 100) : null,
  };
}
