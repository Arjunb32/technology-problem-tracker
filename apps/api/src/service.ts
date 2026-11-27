import type {
  Profile,
  Problem,
  Solution,
  ProblemDetail,
  FeedSort,
  FeedResult,
  PublicProfile,
  Attachment,
  Comment,
  ModerationReport,
  ModerationData,
  Notification,
  MergePreview,
} from '@tracker/contracts';
import {
  problemInputSchema,
  solutionInputSchema,
  participationSchema,
  solutionTestSchema,
  verificationSchema,
  statusChangeSchema,
  profileSchema,
  reportSchema,
} from '@tracker/contracts';
import {
  reasonSchema,
  commentSchema,
  hideSchema,
  restrictSchema,
  mergeSchema,
} from '@tracker/contracts';
import { ApiFailure, fail, type Store, type StoredAttachment } from './state.js';
import type { ProductionStore } from './store.js';
import {
  decode_image,
  dispatch,
  dispatch_read,
  encode_image,
  image_extension,
} from '../generated/tracker_core.js';

// The host provides the clock, entropy, authenticated storage and Web File interface.
// Each retry runs the Rust command against the transaction's fresh snapshot.
export class TrackerService {
  constructor(
    public store: Store,
    private publicUrl: string,
  ) {}
  private request(op: string, actor: string | null, id: string, data: unknown) {
    return JSON.stringify({
      op,
      actor: actor ?? '',
      id,
      data,
      publicUrl: this.publicUrl,
      demo: this.store.demo,
      now: new Date().toISOString(),
      seed: crypto.randomUUID(),
    });
  }
  private async snapshot(op: string, id: string) {
    const scope = op === 'detail' ? id : undefined;
    return this.store.readJson
      ? this.store.readJson(scope)
      : JSON.stringify(await this.store.read(scope));
  }
  public async readBody(op: string, actor: string | null, id: string, data: unknown = {}) {
    const snapshot = await this.snapshot(op, id);
    try {
      return dispatch_read(snapshot, this.request(op, actor, id, data));
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('{')) throw error;
      const { status, code, message } = JSON.parse(error.message);
      throw new ApiFailure(status, code, message);
    }
  }
  private async read<T>(op: string, actor: string | null, id = '', data: unknown = {}): Promise<T> {
    return JSON.parse(await this.readBody(op, actor, id, data));
  }
  private write<T>(op: string, actor: string, id = '', data: unknown = {}) {
    if (this.store.command) return this.store.command<T>(this.request(op, actor, id, data));
    return this.store.transaction((s) => {
      const result = JSON.parse(dispatch(JSON.stringify(s), this.request(op, actor, id, data)));
      if (result.failure)
        throw new ApiFailure(result.failure.status, result.failure.code, result.failure.message);
      Object.assign(s, result.state);
      return result.value as T;
    });
  }
  executeWrite(op: string, actor: string, id: string, data: unknown) {
    return this.write(op, actor, id, data);
  }
  async ensureProfile(actor: string, displayName: string, avatarUrl?: string) {
    const saved = this.store.profile
      ? await this.store.profile(actor)
      : (await this.store.read()).profiles.find((p) => p.id === actor);
    return saved ?? this.write<Profile>('ensureProfile', actor, '', { displayName, avatarUrl });
  }
  async me(actor: string): Promise<Profile> {
    if (this.store.profile)
      return (
        (await this.store.profile(actor)) ?? fail(401, 'unauthorized', 'Please sign in again.')
      );
    return this.read('me', actor);
  }
  async feed(
    actor: string | null,
    sort: FeedSort,
    category?: string,
    q?: string,
    offset = 0,
  ): Promise<FeedResult> {
    if ('feed' in this.store)
      return (this.store as ProductionStore).feed({
        sort,
        category,
        q,
        viewerId: actor ?? undefined,
        offset,
      });
    return this.read('feed', actor, '', { sort, category, q, offset });
  }
  detail(id: string, actor: string | null) {
    return this.read<ProblemDetail>('detail', actor, id);
  }
  getSolution(id: string, actor: string | null) {
    return this.read<Solution>('getSolution', actor, id);
  }
  publicProfile(id: string, actor: string | null) {
    return this.read<{ profile: PublicProfile; problems: Problem[]; solutions: Solution[] }>(
      'publicProfile',
      actor,
      id,
    );
  }
  notifications(actor: string) {
    return this.read<Notification[]>('notifications', actor);
  }
  following(actor: string) {
    return this.read<Problem[]>('following', actor);
  }
  markNotification(actor: string, id: string) {
    return this.write<Notification>('markNotification', actor, id);
  }
  moderation(actor: string) {
    return this.read<ModerationData>('moderation', actor);
  }
  mergePreview(actor: string, sourceId: string, targetId: string) {
    return this.read<MergePreview>('mergePreview', actor, '', { sourceId, targetId });
  }
  async updateProfile(actor: string, input: unknown) {
    return this.write<Profile>('updateProfile', actor, '', profileSchema.parse(input));
  }
  async createProblem(actor: string, input: unknown) {
    return this.write<Problem>('createProblem', actor, '', problemInputSchema.parse(input));
  }
  async editProblem(actor: string, id: string, input: unknown) {
    return this.write<Problem>('editProblem', actor, id, problemInputSchema.parse(input));
  }
  async participate(actor: string, id: string, input: unknown) {
    return this.write<Problem>('participate', actor, id, participationSchema.parse(input));
  }
  async comment(actor: string, id: string, input: unknown) {
    return this.write<Comment>('comment', actor, id, commentSchema.parse(input));
  }
  async addSolution(actor: string, id: string, input: unknown) {
    return this.write<Solution>('addSolution', actor, id, solutionInputSchema.parse(input));
  }
  async editSolution(actor: string, id: string, input: unknown) {
    return this.write<Solution>('editSolution', actor, id, solutionInputSchema.parse(input));
  }
  async test(actor: string, id: string, input: unknown) {
    return this.write<Solution>('test', actor, id, solutionTestSchema.parse(input));
  }
  async report(actor: string, input: unknown) {
    return this.write<ModerationReport>('report', actor, '', reportSchema.parse(input));
  }
  async reopen(actor: string, id: string, input: unknown) {
    return this.write<ModerationReport>('reopen', actor, id, reasonSchema.parse(input));
  }
  async verify(actor: string, id: string, input: unknown) {
    return this.write<Solution>('verify', actor, id, verificationSchema.parse(input));
  }
  async status(actor: string, id: string, input: unknown) {
    return this.write<Problem>('status', actor, id, statusChangeSchema.parse(input));
  }
  async hide(actor: string, input: unknown) {
    return this.write<{ ok: boolean }>('hide', actor, '', hideSchema.parse(input));
  }
  async restrict(actor: string, id: string, input: unknown) {
    return this.write<Profile>('restrict', actor, id, restrictSchema.parse(input));
  }
  async merge(actor: string, input: unknown) {
    return this.write<MergePreview>('merge', actor, '', mergeSchema.parse(input));
  }
  async resolveReport(actor: string, id: string, input: unknown) {
    return this.write<ModerationReport>('resolveReport', actor, id, reasonSchema.parse(input));
  }
  async upload(actor: string, targetType: 'problem' | 'solution', targetId: string, file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length || bytes.length > 500 * 1024)
      fail(422, 'invalid_upload', 'Images must be nonempty and no larger than 500 KB.');
    const mime = file.type,
      ext = image_extension(bytes.subarray(0, 12), mime);
    if (!ext) fail(422, 'invalid_upload', 'Upload a valid JPEG, PNG, or WebP image.');
    const id = crypto.randomUUID(),
      path = actor + '/' + id + '.' + ext;
    const record = {
      id,
      name: file.name.slice(0, 200),
      mimeType: mime,
      size: bytes.length,
      url: this.publicUrl + '/api/v1/attachments/' + id,
      targetType,
      targetId,
      ownerId: actor,
      ...(this.store.demo ? { data: encode_image(bytes) } : { storagePath: path }),
    };
    await this.read('authorizeUpload', actor, '', { targetType, targetId });
    if (this.store.putImage) await this.store.putImage(path, bytes, mime);
    try {
      return await this.write<Attachment>('upload', actor, '', record);
    } catch (e) {
      if (this.store.removeImage) await this.store.removeImage(path).catch(() => undefined);
      throw e;
    }
  }
  async image(id: string, actor: string | null) {
    const a = await this.read<StoredAttachment>('image', actor, id);
    const bytes = a.data ? decode_image(a.data) : await this.store.getImage!(a.storagePath!);
    return { bytes, mime: a.mimeType };
  }
  async deleteImage(actor: string, id: string) {
    const a = await this.read<StoredAttachment>('authorizeDeletion', actor, id);
    if (a.storagePath && this.store.removeImage) await this.store.removeImage(a.storagePath);
    return this.write<{ ok: boolean }>('deleteImage', actor, id);
  }
}
