import { crypto } from "@k2b/stdlib";

export const AI_SHORT_ID_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz]{6}$/;

export const createAiShortId = (): string => crypto.common.readableId(6);

export const withAiShortId = async <T>(constraint: string, insert: (shortId: string) => Promise<T>): Promise<T> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await insert(createAiShortId());
    } catch (error) {
      const collision =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505" &&
        "constraint" in error &&
        error.constraint === constraint;
      if (!collision) throw error;
    }
  }
  throw new Error("Failed to allocate a unique AI short ID");
};
