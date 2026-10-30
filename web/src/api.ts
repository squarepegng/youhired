export const DEMO = import.meta.env.VITE_DEMO === "1";

export async function api<T = unknown>(path: string, body?: unknown, method?: string): Promise<T> {
  // Public demo: everything runs in the browser on sample data.
  if (DEMO) return (await import("./demo")).demoApi<T>(path, body, method);
  const isForm = body instanceof FormData;
  const res = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined || isForm ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}
