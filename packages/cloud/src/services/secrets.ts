import { decryptValue, encryptValue } from "./settings/crypto";

export const encryptSecret = async (value: unknown): Promise<string> => encryptValue(value);

export const decryptSecret = async <T = unknown>(value: string): Promise<T> => (await decryptValue(value)) as T;

export const secrets = {
  encrypt: encryptSecret,
  decrypt: decryptSecret,
};
