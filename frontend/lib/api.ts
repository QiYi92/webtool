import { getToken } from "@/lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8888";

/** Build a backend URL from the environment-specific browser API base. */
export function getApiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

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

  const response = await fetch(getApiUrl(path), {
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

export async function fetchBlob(path: string, options: RequestInit = {}): Promise<Blob> {
  const headers = new Headers(options.headers);
  const token = getToken();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(getApiUrl(path), {
    ...options,
    headers
  });

  if (!response.ok) {
    const body = await response.text();
    try {
      const data = body ? JSON.parse(body) : null;
      throw new Error(data?.detail || "文件下载失败");
    } catch (error) {
      if (error instanceof Error && error.message !== "Unexpected end of JSON input") {
        throw error;
      }
      throw new Error("文件下载失败");
    }
  }

  return response.blob();
}
