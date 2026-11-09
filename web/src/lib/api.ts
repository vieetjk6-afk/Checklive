export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Gọi API server. Lỗi 401 -> chuyển về trang đăng nhập. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      window.location.href = '/login';
    }
    throw new ApiError((data as { error?: string }).error ?? `Lỗi ${res.status}`, res.status);
  }
  return data as T;
}
