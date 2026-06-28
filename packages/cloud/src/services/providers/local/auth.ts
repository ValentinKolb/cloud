import { redis } from "bun";

export const createMagicLinkToken = async (params: { email: string; ttlSeconds?: number }): Promise<string> => {
  const token = crypto.randomUUID();
  await redis.set(`email-login:${token}`, JSON.stringify({ email: params.email }), "EX", params.ttlSeconds ?? 300);
  return token;
};

export const consumeMagicLinkToken = async (token: string): Promise<{ email: string } | null> => {
  const raw = await redis.getdel(`email-login:${token}`);
  if (!raw) return null;
  return JSON.parse(raw) as { email: string };
};

type PasswordResetPayload = {
  userId: string;
  uid: string;
  email: string;
};

const passwordResetTokenKey = (token: string) => `password-reset:${token}`;

export const createPasswordResetToken = async (params: PasswordResetPayload & { ttlSeconds?: number }): Promise<string> => {
  const token = crypto.randomUUID();
  await redis.set(
    passwordResetTokenKey(token),
    JSON.stringify({
      userId: params.userId,
      uid: params.uid,
      email: params.email,
    }),
    "EX",
    params.ttlSeconds ?? 900,
  );
  return token;
};

export const consumePasswordResetToken = async (token: string): Promise<PasswordResetPayload | null> => {
  const raw = await redis.getdel(passwordResetTokenKey(token));
  if (!raw) return null;
  return JSON.parse(raw) as PasswordResetPayload;
};
