const withJsonContentType = (init?: RequestInit): Headers => {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return headers;
};

const messageFromBody = (body: unknown, fallback: string): string => {
  return body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : fallback;
};

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  return messageFromBody(body, fallback);
};

const isJsonResponse = (response: Response): boolean => {
  return (response.headers.get("Content-Type") ?? "").includes("application/json");
};

const readSuccess = async <T,>(response: Response): Promise<T> => {
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text.trim() || !isJsonResponse(response)) return undefined as T;
  return JSON.parse(text) as T;
};

export const jsonFetch = async <T,>(url: string, init?: RequestInit, fallback = "Request failed"): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: withJsonContentType(init),
  });
  if (!response.ok) throw new Error(await readError(response, fallback));
  return readSuccess<T>(response);
};
