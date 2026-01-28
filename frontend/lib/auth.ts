const TOKEN_KEY = "auth_token";

export function getToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function isAuthed(): boolean {
  return Boolean(getToken());
}

export function signOut() {
  window.localStorage.removeItem(TOKEN_KEY);
}
