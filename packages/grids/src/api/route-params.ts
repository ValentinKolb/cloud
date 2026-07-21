import type { AuthContext } from "@valentinkolb/cloud/server";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";

const UuidStringSchema = z.string().uuid();

export const isUuid = (value: string): boolean => UuidStringSchema.safeParse(value).success;

export const uuidParam = (context: Context<AuthContext>, name: string): string | null => {
  const value = context.req.param(name);
  return value && isUuid(value) ? value : null;
};

export const requireUuidParam =
  (name: string, resource: string): MiddlewareHandler<AuthContext> =>
  async (context, next) => {
    if (!uuidParam(context, name)) return context.json({ message: `${resource} not found` }, 404);
    await next();
  };
