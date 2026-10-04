import { z } from 'zod';
import {
  problemInputSchema,
  solutionInputSchema,
  solutionTestSchema,
  verificationSchema,
  statusChangeSchema,
  profileSchema,
  reportSchema,
  categories,
  statuses,
  outcomes,
} from '@tracker/contracts';
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const text = { type: 'string' };
const flag = { type: 'boolean' };
const integer = { type: 'integer' };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
});
const list = (name: string) => ({ type: 'array', items: ref(name) });
const reason = object({ reason: { type: 'string', minLength: 10, maxLength: 2000 } }, ['reason']);
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
export function openapi(demo: boolean) {
  const schemas: Record<string, unknown> = {
    ApiError: object({ error: text, message: text, requestId: text, details: {} }, [
      'error',
      'message',
    ]),
    Profile: object(
      {
        id: text,
        username: text,
        displayName: text,
        bio: text,
        expertise: { type: 'array', items: text },
        avatarUrl: text,
        role: { type: 'string', enum: ['member', 'moderator', 'admin'] },
        restricted: flag,
        createdAt: text,
      },
      ['id', 'username', 'displayName', 'role'],
    ),
    Attachment: object(
      {
        id: text,
        name: text,
        mimeType: text,
        size: integer,
        url: text,
        targetType: { type: 'string', enum: ['problem', 'solution'] },
        targetId: text,
        ownerId: text,
      },
      ['id', 'url', 'targetId'],
    ),
    PublicProfile: object(
      {
        id: text,
        username: text,
        displayName: text,
        bio: text,
        expertise: { type: 'array', items: text },
        avatarUrl: text,
        role: { type: 'string', enum: ['member', 'moderator', 'admin'] },
        createdAt: text,
      },
      ['id', 'username', 'displayName', 'role'],
    ),
    Problem: object(
      {
        id: text,
        authorId: text,
        author: ref('PublicProfile'),
        title: text,
        description: text,
        category: { type: 'string', enum: categories },
        product: text,
        classification: { type: 'string', enum: ['Hardware', 'Software', 'Both'] },
        setup: text,
        symptoms: text,
        steps: text,
        attemptedFixes: text,
        tags: { type: 'array', items: text },
        status: { type: 'string', enum: statuses },
        canonicalId: { type: ['string', 'null'] },
        hidden: flag,
        demo: flag,
        createdAt: text,
        updatedAt: text,
        resolvedAt: { type: ['string', 'null'] },
        version: integer,
        affectedCount: integer,
        voteCount: integer,
        followerCount: integer,
        solutionCount: integer,
        verifiedCount: integer,
        recentAffectedCount: integer,
        recentVoteCount: integer,
        viewer: object({ affected: flag, voted: flag, following: flag, setup: text }),
        attachments: list('Attachment'),
      },
      ['id', 'title', 'status', 'author', 'viewer'],
    ),
    SolutionTest: object({
      id: text,
      userId: text,
      revisionId: text,
      outcome: { type: 'string', enum: outcomes },
      setup: text,
      evidence: text,
      createdAt: text,
      updatedAt: text,
    }),
    Verification: object({
      id: text,
      reviewerId: text,
      evidence: text,
      supportedScope: text,
      reason: text,
      decision: { type: 'string', enum: ['verified', 'revoked'] },
      createdAt: text,
    }),
    SolutionRevision: object({
      id: text,
      number: integer,
      title: text,
      instructions: text,
      reasoning: text,
      supportedSetup: text,
      limitations: text,
      warnings: text,
      createdAt: text,
      tests: list('SolutionTest'),
      verification: { anyOf: [ref('Verification'), { type: 'null' }] },
    }),
    Solution: object(
      {
        id: text,
        problemId: text,
        authorId: text,
        author: ref('PublicProfile'),
        hidden: flag,
        demo: flag,
        createdAt: text,
        updatedAt: text,
        currentRevision: ref('SolutionRevision'),
        revisions: list('SolutionRevision'),
        attachments: list('Attachment'),
      },
      ['id', 'problemId', 'currentRevision'],
    ),
    Comment: object({
      id: text,
      problemId: text,
      authorId: text,
      author: ref('PublicProfile'),
      body: text,
      hidden: flag,
      createdAt: text,
    }),
    TimelineEvent: object({
      id: text,
      problemId: text,
      actorId: { type: ['string', 'null'] },
      kind: text,
      fromStatus: { type: ['string', 'null'] },
      toStatus: { type: ['string', 'null'] },
      reason: text,
      createdAt: text,
    }),
    ProblemDetail: object(
      {
        problem: ref('Problem'),
        solutions: list('Solution'),
        comments: list('Comment'),
        timeline: list('TimelineEvent'),
        related: list('Problem'),
        redirectId: text,
      },
      ['problem', 'solutions', 'comments', 'timeline', 'related'],
    ),
    FeedResult: object({ items: list('Problem'), total: integer }, ['items', 'total']),
    Notification: object({
      id: text,
      userId: text,
      problemId: { type: ['string', 'null'] },
      title: text,
      body: text,
      read: flag,
      createdAt: text,
    }),
    ModerationReport: object({
      id: text,
      reporterId: text,
      targetType: { type: 'string', enum: ['problem', 'solution', 'comment', 'profile'] },
      targetId: text,
      reason: text,
      details: text,
      state: { type: 'string', enum: ['open', 'resolved'] },
      createdAt: text,
    }),
    AuditEvent: object({
      id: text,
      actorId: text,
      action: text,
      targetId: text,
      reason: text,
      createdAt: text,
    }),
    ModerationData: object({
      reports: list('ModerationReport'),
      verificationQueue: list('Solution'),
      solutions: list('Solution'),
      comments: list('Comment'),
      profiles: list('Profile'),
      audit: list('AuditEvent'),
      problems: list('Problem'),
    }),
    MergePreview: object({
      source: ref('Problem'),
      target: ref('Problem'),
      affectedBefore: integer,
      affectedAfter: integer,
      votesBefore: integer,
      votesAfter: integer,
      followersBefore: integer,
      followersAfter: integer,
    }),
    AppConfig: object({
      demo: flag,
      configuredAuth: flag,
      providers: { type: 'array', items: { type: 'string', enum: ['google', 'github', 'azure'] } },
      demoAccounts: list('Profile'),
    }),
    ProblemInput: z.toJSONSchema(problemInputSchema, { io: 'input' }),
    SolutionInput: z.toJSONSchema(solutionInputSchema, { io: 'input' }),
    SolutionTestInput: z.toJSONSchema(solutionTestSchema, { io: 'input' }),
    VerificationInput: z.toJSONSchema(verificationSchema, { io: 'input' }),
    StatusChangeInput: z.toJSONSchema(statusChangeSchema, { io: 'input' }),
    ProfileInput: z.toJSONSchema(profileSchema, { io: 'input' }),
    ReportInput: z.toJSONSchema(reportSchema, { io: 'input' }),
    ParticipationInput: object(
      {
        kind: { type: 'string', enum: ['affected', 'vote', 'follow'] },
        active: flag,
        setup: { type: 'string', maxLength: 2000 },
      },
      ['kind', 'active'],
    ),
    ReasonInput: reason,
    MergeInput: object(
      { sourceId: text, targetId: text, reason: { type: 'string', minLength: 10 } },
      ['sourceId', 'targetId', 'reason'],
    ),
    ContentInput: object(
      {
        targetType: { type: 'string', enum: ['problem', 'solution', 'comment'] },
        targetId: text,
        hidden: flag,
        reason: { type: 'string', minLength: 10 },
      },
      ['targetType', 'targetId', 'hidden', 'reason'],
    ),
    RestrictInput: object({ restricted: flag, reason: { type: 'string', minLength: 10 } }, [
      'restricted',
      'reason',
    ]),
    CommentInput: object({ body: { type: 'string', minLength: 2, maxLength: 5000 } }, ['body']),
    Success: object({ ok: { const: true } }, ['ok']),
    AuthResult: object({ token: text, profile: ref('Profile') }),
    ProfileResult: object({
      profile: ref('PublicProfile'),
      problems: list('Problem'),
      solutions: list('Solution'),
    }),
  };
  const paths: Record<string, Record<string, unknown>> = {};
  const add = (
    path: string,
    method: Method,
    summary: string,
    response: string,
    input?: string,
    secure = false,
    array = false,
    status = 200,
  ) => {
    const parameters = [...path.matchAll(/\{(\w+)\}/g)].map((x) => ({
      name: x[1],
      in: 'path',
      required: true,
      schema: text,
    }));
    const operation: Record<string, unknown> = {
      summary,
      operationId: `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      parameters,
      security: secure ? [{ bearerAuth: [] }] : [],
      responses: {
        [status]: {
          description: 'Successful response',
          content: { 'application/json': { schema: array ? list(response) : ref(response) } },
        },
        '401': {
          description: 'Sign-in required',
          content: { 'application/json': { schema: ref('ApiError') } },
        },
        '403': {
          description: 'Permission denied',
          content: { 'application/json': { schema: ref('ApiError') } },
        },
        '409': {
          description: 'Concurrent update or lifecycle conflict',
          content: { 'application/json': { schema: ref('ApiError') } },
        },
        '422': {
          description: 'Validation or evidence requirement failed',
          content: { 'application/json': { schema: ref('ApiError') } },
        },
        '429': {
          description: '40 writes per account per minute',
          content: { 'application/json': { schema: ref('ApiError') } },
        },
        '503': {
          description: 'Capacity or service unavailable',
          content: { 'application/json': { schema: ref('ApiError') } },
        },
      },
    };
    if (input)
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: ref(input) } },
      };
    (paths[path] ??= {})[method] = operation;
  };
  add('/config', 'get', 'Public runtime configuration', 'AppConfig');
  add('/me', 'get', 'Current profile', 'Profile', undefined, true);
  add('/me', 'patch', 'Update your profile', 'Profile', 'ProfileInput', true);
  add('/profiles/{id}', 'get', 'Public profile and contributions', 'ProfileResult');
  add('/me/following', 'get', 'Followed problems', 'Problem', undefined, true, true);
  add('/me/notifications', 'get', 'Your notifications', 'Notification', undefined, true, true);
  add(
    '/me/notifications/{id}',
    'patch',
    'Mark a notification read',
    'Notification',
    undefined,
    true,
  );
  (paths['/me/notifications/{id}'].patch as Record<string, unknown>).requestBody = {
    required: true,
    content: { 'application/json': { schema: object({ read: { const: true } }, ['read']) } },
  };
  add('/problems', 'get', 'Discover problems; returns at most 50 results', 'FeedResult');
  (paths['/problems'].get as Record<string, unknown>).parameters = [
    {
      name: 'sort',
      in: 'query',
      schema: {
        type: 'string',
        enum: ['trending', 'affected', 'unsolved', 'solved', 'new'],
        default: 'trending',
      },
    },
    { name: 'category', in: 'query', schema: { type: 'string', enum: categories } },
    { name: 'q', in: 'query', schema: { type: 'string', maxLength: 180 } },
    {
      name: 'offset',
      in: 'query',
      schema: { type: 'integer', minimum: 0, maximum: 500, default: 0 },
    },
  ];
  add('/problems', 'post', 'Report a problem', 'Problem', 'ProblemInput', true, false, 201);
  add('/problems/{id}', 'get', 'Problem, solutions, evidence, and timeline', 'ProblemDetail');
  add(
    '/problems/{id}',
    'patch',
    'Edit your report; requires the current version',
    'Problem',
    'ProblemInput',
    true,
  );
  add(
    '/problems/{id}/participation',
    'put',
    'Set your affected confirmation, vote, or follow',
    'Problem',
    'ParticipationInput',
    true,
  );
  add(
    '/problems/{id}/comments',
    'post',
    'Join the discussion',
    'Comment',
    'CommentInput',
    true,
    false,
    201,
  );
  add(
    '/problems/{id}/solutions',
    'post',
    'Propose a solution',
    'Solution',
    'SolutionInput',
    true,
    false,
    201,
  );
  add('/solutions/{id}', 'get', 'A solution and its revision history', 'Solution');
  add(
    '/solutions/{id}',
    'patch',
    'Create a new material revision',
    'Solution',
    'SolutionInput',
    true,
  );
  add(
    '/solutions/{id}/tests',
    'put',
    'Set one test result per user per revision',
    'Solution',
    'SolutionTestInput',
    true,
  );
  add(
    '/reports',
    'post',
    'Report harmful content',
    'ModerationReport',
    'ReportInput',
    true,
    false,
    201,
  );
  add(
    '/problems/{id}/reopen',
    'post',
    'Request moderator reopening',
    'ModerationReport',
    'ReasonInput',
    true,
    false,
    201,
  );
  add(
    '/attachments',
    'post',
    'Attach a JPEG, PNG, or WebP image, at most 500 KB',
    'Attachment',
    undefined,
    true,
    false,
    201,
  );
  (paths['/attachments'].post as Record<string, unknown>).requestBody = {
    required: true,
    content: {
      'multipart/form-data': {
        schema: object(
          {
            targetType: { type: 'string', enum: ['problem', 'solution'] },
            targetId: text,
            file: { type: 'string', format: 'binary' },
          },
          ['targetType', 'targetId', 'file'],
        ),
      },
    },
  };
  paths['/attachments/{id}'] = {
    get: {
      summary: 'Image content, respecting content visibility',
      parameters: [{ name: 'id', in: 'path', required: true, schema: text }],
      responses: {
        '200': {
          description: 'Image bytes',
          content: {
            'image/jpeg': { schema: { type: 'string', format: 'binary' } },
            'image/png': { schema: { type: 'string', format: 'binary' } },
            'image/webp': { schema: { type: 'string', format: 'binary' } },
          },
        },
      },
    },
  };
  add('/attachments/{id}', 'delete', 'Delete your attachment', 'Success', undefined, true);
  add('/moderation', 'get', 'Moderator review workspace', 'ModerationData', undefined, true);
  add(
    '/moderation/solutions/{id}/verify',
    'post',
    'Review current independent test evidence; self review prohibited',
    'Solution',
    'VerificationInput',
    true,
  );
  add(
    '/moderation/problems/{id}/status',
    'post',
    'Change a problem lifecycle status with a reason',
    'Problem',
    'StatusChangeInput',
    true,
  );
  add('/moderation/content', 'post', 'Hide or restore content', 'Success', 'ContentInput', true);
  add(
    '/moderation/profiles/{id}/restrict',
    'post',
    'Restrict or restore an account',
    'Profile',
    'RestrictInput',
    true,
  );
  add(
    '/moderation/merge-preview',
    'get',
    'Preview deduplicated participation before merging',
    'MergePreview',
    undefined,
    true,
  );
  (paths['/moderation/merge-preview'].get as Record<string, unknown>).parameters = [
    'sourceId',
    'targetId',
  ].map((name) => ({ name, in: 'query', required: true, schema: text }));
  add(
    '/moderation/merge',
    'post',
    'Atomically merge duplicate contributions',
    'MergePreview',
    'MergeInput',
    true,
  );
  add(
    '/moderation/reports/{id}/resolve',
    'post',
    'Resolve a moderation report with an audit reason',
    'ModerationReport',
    'ReasonInput',
    true,
  );
  if (demo) {
    schemas.DemoAuthInput = object(
      { userId: { type: 'string', enum: ['demo-alex', 'demo-sam', 'demo-morgan'] } },
      ['userId'],
    );
    add('/auth/demo', 'post', 'Loopback-only demonstration sign-in', 'AuthResult', 'DemoAuthInput');
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Technology Problem Tracker API',
      version: '1.0.0',
      description:
        'Public browsing and authenticated contribution. Moderator endpoints require stored moderator/admin roles. No email or privileged credentials appear in responses.',
    },
    servers: [{ url: '/api/v1' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: demo ? 'Local demo token' : 'Supabase access token',
        },
      },
      schemas,
    },
  };
}
