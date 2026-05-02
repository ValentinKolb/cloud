/**
 * Reads a JSON `{ message }` payload from a non-OK fetch response, falling
 * back to a caller-supplied default. Shared across the grids islands so we
 * don't copy this 6-line block into every mutation.
 */
export const errorMessage = async (res: Response, fallback: string): Promise<string> => {
  try {
    const data = (await res.json()) as { message?: string };
    if (typeof data.message === "string" && data.message.length > 0) return data.message;
  } catch {}
  return fallback;
};
