import { useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUp,
  Users,
  MessageSquare,
  CheckCircle2,
  ChevronRight,
  ImagePlus,
  X,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import type { Problem, ProblemStatus, Profile, Attachment, TargetType } from '@tracker/contracts';
import { command, apiBlob, compressImage, uploadImages, UploadFailure } from './api';
import { reconcileDraft, requestPlan } from './browser';
import { useSession, initials } from './context';
import { useModalAccessibility } from './modal';

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    loader()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [...deps, reloadKey]);
  return { data, error, loading, reload: () => setReloadKey((value) => value + 1), setData };
}
export function useDraft<T>(key: string, defaults: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(key);
      return reconcileDraft(defaults, saved);
    } catch {
      return defaults;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Keep the draft in memory if the browser has disabled storage or exhausted its quota.
    }
  }, [key, value]);
  const clear = () => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // The browser may disallow access to session storage.
    }
  };
  return [value, setValue, clear] as const;
}
export function shortDate(date: string) {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(date));
}
export function relativeDate(date: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000));
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}
export function Status({ status }: { status: ProblemStatus }) {
  return (
    <span className={`status status-${status.toLowerCase().replaceAll(' ', '-')}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
}
export function Avatar({
  profile,
  size = 'normal',
}: {
  profile: Pick<Profile, 'displayName' | 'avatarUrl'>;
  size?: 'normal' | 'large';
}) {
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {profile.avatarUrl ? (
        <img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        initials(profile.displayName)
      )}
    </span>
  );
}
export function Loading({ label = 'Loading the community…' }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <RefreshCw className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}
export function ErrorState({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="empty-state">
      <AlertTriangle size={30} />
      <h3>Something interrupted the connection</h3>
      <p>{error}</p>
      <button className="button secondary" onClick={retry}>
        <RefreshCw size={16} />
        Try again
      </button>
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <MessageSquare size={32} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Field({
  label,
  hint,
  children,
  required = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required && <span className="required"> *</span>}
      </span>
      {hint && <small>{hint}</small>}
      {children}
    </label>
  );
}
export function PlainText({ children, className = '' }: { children: string; className?: string }) {
  return <div className={`plain-text ${className}`}>{children}</div>;
}
export function ProblemCard({ problem }: { problem: Problem }) {
  return (
    <article className="problem-card">
      <div className="card-top">
        <span className={`category-label category-${problem.category.toLowerCase()}`}>
          {problem.category}
        </span>
        <span className="card-product">{problem.product}</span>
        <Status status={problem.status} />
        {problem.demo && <span className="sample-label">Sample issue</span>}
      </div>
      <Link className="problem-title" to={`/problems/${problem.id}`}>
        <h2>{problem.title}</h2>
      </Link>
      <p className="problem-excerpt">{problem.description}</p>
      <div className="card-tags">
        {problem.tags.slice(0, 3).map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <div className="card-bottom">
        <div className="card-stats">
          <span title="People reporting this issue on their setup">
            <Users size={16} />
            <strong>{problem.affectedCount}</strong> affected
          </span>
          <span title="People considering this important">
            <ArrowUp size={16} />
            <strong>{problem.voteCount}</strong>
          </span>
          <span>
            <MessageSquare size={16} />
            <strong>{problem.solutionCount}</strong> {problem.solutionCount === 1 ? 'fix' : 'fixes'}
          </span>
          {problem.verifiedCount > 0 && (
            <span className="verified-count">
              <CheckCircle2 size={16} />
              Verified fix
            </span>
          )}
        </div>
        <div className="card-author">
          <Avatar profile={problem.author} />
          <span>
            {problem.author.displayName.split(' ')[0]}{' '}
            <span className="muted">· {relativeDate(problem.createdAt)}</span>
          </span>
        </div>
      </div>
    </article>
  );
}
export function ImagesInput({
  files,
  setFiles,
  existing = 0,
}: {
  files: File[];
  setFiles: (files: File[]) => void;
  existing?: number;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [files]);
  async function select(list: FileList | null) {
    if (!list) return;
    setError('');
    if (list.length + files.length + existing > 3) {
      setError('Attach up to three images per contribution.');
      return;
    }
    setBusy(true);
    try {
      const images = await Promise.all(Array.from(list).map(compressImage));
      setFiles([...files, ...images]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="images-input">
      <label className="upload-area">
        <ImagePlus size={25} />
        <strong>{busy ? 'Preparing your images…' : 'Add screenshots'}</strong>
        <span>JPEG, PNG or WebP · 3 images maximum · compressed to 500 KB</span>
        <input
          aria-label="Add screenshots"
          disabled={busy || files.length + existing >= 3}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(event) => {
            void select(event.target.files);
            event.target.value = '';
          }}
        />
      </label>
      {files.length > 0 && (
        <div className="image-previews">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`}>
              <img src={previews[index]} alt={`Preview of ${file.name}`} />
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles(files.filter((_, i) => i !== index))}
              >
                <X size={16} />
              </button>
              <small>
                {file.name} · {Math.round(file.size / 1024)} KB
              </small>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function Attachments({
  items,
  targetType,
  targetId,
  ownerId,
  refresh,
}: {
  items: Attachment[];
  targetType: 'problem' | 'solution';
  targetId: string;
  ownerId: string;
  refresh: () => void;
}) {
  const { profile, notice } = useSession();
  const [adding, setAdding] = useState(false),
    [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false);
  const canEdit = profile?.id === ownerId && !profile?.restricted;
  async function upload() {
    setBusy(true);
    try {
      await uploadImages(files, targetType, targetId);
      setFiles([]);
      setAdding(false);
      refresh();
      notice('Screenshots added.');
    } catch (error) {
      if (error instanceof UploadFailure) setFiles((current) => current.slice(error.completed));
      notice((error as Error).message, 'error');
      refresh();
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!window.confirm('Remove this screenshot?')) return;
    try {
      await command('deleteImage', id);
      refresh();
      notice('Screenshot removed.');
    } catch (error) {
      notice((error as Error).message, 'error');
    }
  }
  return (
    <div className="attachments">
      {items.length > 0 && (
        <div className="attachment-gallery">
          {items.map((item) => (
            <AttachmentImage
              key={item.id}
              item={item}
              canRemove={profile?.id === item.ownerId && !profile?.restricted}
              onRemove={() => void remove(item.id)}
            />
          ))}
        </div>
      )}
      {canEdit && items.length < 3 && !adding && (
        <button className="text-link" onClick={() => setAdding(true)}>
          <ImagePlus size={16} />
          Add screenshots
        </button>
      )}
      {adding && (
        <div className="attachment-editor">
          <ImagesInput files={files} setFiles={setFiles} existing={items.length} />
          <div className="button-row">
            <button
              className="button small"
              disabled={busy || !files.length}
              onClick={() => void upload()}
            >
              {busy ? 'Uploading…' : 'Upload images'}
            </button>
            <button className="button secondary small" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function AttachmentImage({
  item,
  canRemove,
  onRemove,
}: {
  item: Attachment;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const { profile } = useSession();
  const [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true,
      objectUrl = '';
    setUrl('');
    setError('');
    void apiBlob(requestPlan('readImage', item.id).path)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.id, profile?.id, retry]);
  return (
    <figure>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={item.name} loading="lazy" />
        </a>
      ) : (
        <div className="attachment-state" role={error ? 'alert' : 'status'}>
          {error ? (
            <>
              <span>{error}</span>
              <button className="text-link" onClick={() => setRetry((value) => value + 1)}>
                Retry image
              </button>
            </>
          ) : (
            <>
              <RefreshCw size={18} className="spin" />
              <span>Loading image…</span>
            </>
          )}
        </div>
      )}
      <figcaption>
        {item.name}
        {canRemove && (
          <button className="text-link danger" onClick={onRemove}>
            Remove
          </button>
        )}
      </figcaption>
    </figure>
  );
}
export function ReportButton({
  targetType,
  targetId,
}: {
  targetType: TargetType;
  targetId: string;
}) {
  const { requireUser, notice } = useSession();
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState('Misleading or unsupported information'),
    [details, setDetails] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useModalAccessibility(open, () => setOpen(false));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await command('report', undefined, { targetType, targetId, reason, details });
      setOpen(false);
      setDetails('');
      notice('Report sent to the moderators. Thank you.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="text-link muted"
        onClick={() => {
          if (requireUser()) setOpen(true);
        }}
      >
        Report
      </button>
      {open && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Report a concern"
            onSubmit={submit}
          >
            <button
              type="button"
              aria-label="Close report"
              className="icon-button modal-close"
              onClick={() => setOpen(false)}
            >
              <X />
            </button>
            <h2>Help keep this useful</h2>
            <p>
              A moderator will review your report. Explain the concern and include the relevant
              context.
            </p>
            <Field label="Reason">
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option>Misleading or unsupported information</option>
                <option>Harassment or harmful content</option>
                <option>Spam or promotion</option>
                <option>Personal information</option>
                <option>Other concern</option>
              </select>
            </Field>
            <Field label="What should we review?" required>
              <textarea
                value={details}
                minLength={10}
                maxLength={4000}
                required
                onChange={(e) => setDetails(e.target.value)}
                rows={5}
              />
            </Field>
            {error && <p className="inline-error">{error}</p>}
            <button className="button" disabled={busy}>
              {busy ? 'Sending…' : 'Send report'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
export function Breadcrumb({
  current,
  problem,
}: {
  current: string;
  problem?: { id: string; title: string };
}) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <Link to="/">Community</Link>
      <ChevronRight size={14} />
      {problem && (
        <>
          <Link to={`/problems/${problem.id}`}>{problem.title}</Link>
          <ChevronRight size={14} />
        </>
      )}
      <span>{current}</span>
    </nav>
  );
}
