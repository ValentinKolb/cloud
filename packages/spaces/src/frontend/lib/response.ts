export const readResponseError = async (response: Response, fallback: string): Promise<string> => {
  try {
    const data = (await response.json()) as unknown;
    if (data && typeof data === "object" && "message" in data && typeof data.message === "string" && data.message.length > 0) {
      return data.message;
    }
  } catch {
    // Proxies and unavailable upstreams may return plain text or HTML.
  }
  return fallback;
};
