import { z } from "zod";

import { SessionUserSchema } from "@valentinkolb/cloud-contracts/shared";

export const LoginSchema = z.object({
  username: z.string(),
  password: z.string(),
  acceptedAgb: z.literal(true),
});

export const EmailLoginSchema = z.object({
  email: z.email(),
  acceptedAgb: z.literal(true),
});

export const VerifyTokenSchema = z.object({
  token: z.uuid(),
  acceptedAgb: z.literal(true),
});

export const AuthResponseSchema = z.object({
  session_token: z.string(),
  user: SessionUserSchema,
});
