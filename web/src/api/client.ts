import type { ApiErrorBody, ErrorCode } from '@finbridge/shared';

const TOKEN_KEY = 'finbridge.token';

export class ApiError extends Error {
  constructor(public status: number, public code: ErrorCode | 'NETWORK', message: string, public details?: unknown) {
    super(message);
  }
}

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function send(method: string, path: string, body?: BodyInit, json = true): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json && body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (!res.ok) {
    let err: ApiErrorBody['error'] = { code: 'INTERNAL_ERROR', message: res.statusText };
    try { err = ((await res.json()) as ApiErrorBody).error; } catch { /* not JSON */ }
    if (res.status === 401 && path !== '/auth/login') onUnauthorized?.();
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return res;
}

export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body === undefined ? undefined : JSON.stringify(body));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await send('POST', path, form, false);
  return (await res.json()) as T;
}

/** Downloads a file produced by the API (Excel export) using the auth token. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await send('GET', path);
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const qs = (params: Record<string, string | number | undefined | null>): string => {
  const e = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return e.length ? `?${e.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}` : '';
};
