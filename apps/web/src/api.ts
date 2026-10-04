import { createClient } from '@supabase/supabase-js';
import type { ApiError } from '@tracker/contracts';

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
    token &&
    (!options.method || options.method === 'GET') &&
    /^\/(config|problems|profiles|solutions)(\/|\?|$)/.test(path)
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
export const json = (value: unknown) => JSON.stringify(value);

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
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (file.size > 20 * 1024 * 1024)
    throw new Error('Choose an image smaller than 20 MB before compression.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this image.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.78, 0.65, 0.5, 0.35]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', quality),
      );
      if (blob && blob.size <= 500 * 1024)
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', {
          type: 'image/webp',
        });
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
