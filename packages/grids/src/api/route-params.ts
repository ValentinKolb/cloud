import type { AuthContext } from "@valentinkolb/cloud/server";
import type { Context } from "hono";
import { z } from "zod";

const UuidStringSchema = z.string().uuid();

export const isUuid = (value: string): boolean => UuidStringSchema.safeParse(value).success;

export const uuidParam = (context: Context<AuthContext>, name: string): string | null => {
  const value = context.req.param(name);
  return value && isUuid(value) ? value : null;
};
