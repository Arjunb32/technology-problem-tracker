import { createClient } from '@supabase/supabase-js';
import type { ApiError } from '@tracker/contracts';
import { imageOptions, requestPlan, retryPublic, type RequestKind } from './browser';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;
export const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/api/v1';
export class ApiFailure extends Error {
  status: number;
  details: unknown;
  constructor(status: number, value: Partial<ApiError>) {
    super(value.message || 'The request could not be completed.');
    this.status = status;
    this.details = value.details;
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const token = session?.access_token || localStorage.getItem('tracker.demoToken');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(apiBase + path, { ...options, headers });
  } catch {
    throw new Error(
      'Unable to reach the server. Your unsent content is still here. Please try again.',
    );
  }
  if (
    response.status === 401 &&
    retryPublic(path, response.status, options.method, Boolean(token))
  ) {
    if (!session) localStorage.removeItem('tracker.demoToken');
    headers.delete('Authorization');
    try {
      response = await fetch(apiBase + path, { ...options, headers });
    } catch {
      throw new Error('Unable to reach the server. Please try again.');
    }
  }
  const contentType = response.headers.get('content-type') || '';
  const value = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok)
    throw new ApiFailure(
      response.status,
      value || { message: `The server returned ${response.status}. Please try again.` },
    );
  return value as T;
}
export function command<T = unknown>(kind: RequestKind, id?: string, data?: unknown) {
  const plan = requestPlan(kind, id, data);
  return api<T>(plan.path, {
    method: plan.method,
    ...(plan.body !== null && { body: JSON.stringify(plan.body) }),
  });
}

export async function apiBlob(path: string): Promise<Blob> {
  const headers = new Headers();
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const token = session?.access_token || localStorage.getItem('tracker.demoToken');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(apiBase + path, { headers });
  } catch {
    throw new Error('This image could not load. Please try again.');
  }
  if (!response.ok) {
    const value = await response
      .json()
      .catch(() => ({ message: 'This image is unavailable for this account.' }));
    throw new ApiFailure(response.status, value);
  }
  return response.blob();
}

export async function compressImage(file: File): Promise<File> {
  const check = imageOptions(file);
  if (check.error !== undefined) throw new Error(check.error);
  const bitmap = await createImageBitmap(file);
  try {
    const plan = imageOptions(file, bitmap.width, bitmap.height);
    if (plan.error !== undefined) throw new Error(plan.error);
    const { width, height, name, mime, qualities, limit } = plan.data;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this image.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of qualities) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, mime, quality),
      );
      if (blob && blob.size <= limit) return new File([blob], name, { type: mime });
    }
    throw new Error('This image is still above 500 KB. Crop it or choose a smaller image.');
  } finally {
    bitmap.close();
  }
}
export class UploadFailure extends Error {
  constructor(
    message: string,
    public completed: number,
  ) {
    super(message);
  }
}
export async function uploadImages(
  files: File[],
  targetType: 'problem' | 'solution',
  targetId: string,
) {
  let completed = 0;
  for (const file of files) {
    const body = new FormData();
    body.append('targetType', targetType);
    body.append('targetId', targetId);
    body.append('file', file);
    try {
      await api('/attachments', { method: 'POST', body });
      completed += 1;
    } catch (error) {
      throw new UploadFailure((error as Error).message, completed);
    }
  }
}
