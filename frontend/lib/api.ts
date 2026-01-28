import { getToken } from "@/lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8888";

type FetchJsonOptions = RequestInit & {
  json?: unknown;
};

export async function fetchJSON<T>(
  path: string,
  options: FetchJsonOptions = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    let message = "Request failed";
    if (data?.detail) {
      if (Array.isArray(data.detail)) {
        message = data.detail[0]?.msg || message;
      } else {
        message = data.detail;
      }
    }
    throw new Error(message);
  }

  return data as T;
}
