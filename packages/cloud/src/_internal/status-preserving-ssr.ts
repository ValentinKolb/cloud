import type { HtmlFn, RenderFn } from "@k2b/ssr";
import { createSSRHandler } from "@k2b/ssr/hono";
import type { Context, Env, MiddlewareHandler, TypedResponse } from "hono";
import type { StatusCode } from "hono/utils/http-status";

type PageEnv<T extends object> = { Variables: { page: Partial<T> } };
type SsrHandlerResult = RenderFn | Response | TypedResponse;
type SsrHandler<E extends Env, T extends object> = (context: Context<E & PageEnv<T>>) => SsrHandlerResult | Promise<SsrHandlerResult>;

/**
 * Keeps status changes made through Hono's context when the SSR adapter turns
 * a render function into a fresh Response.
 */
export const createStatusPreservingSsrHandler = <T extends object>(html: HtmlFn<T>) => {
  const createHandler = createSSRHandler<T>(html);

  return <E extends Env = Env>(...args: [...MiddlewareHandler<E>[], SsrHandler<E, T>]) => {
    const middlewares = args.slice(0, -1) as MiddlewareHandler<E>[];
    const handler = args[args.length - 1] as SsrHandler<E, T>;

    return createHandler<E>(...middlewares, async (context) => {
      const result = await handler(context as Context<E & PageEnv<T>>);
      if (result instanceof Response || typeof result !== "function") return result;

      const status = context.newResponse(null).status;
      if (status === 200) return result;

      const response = await html(result, context.get("page") as T);
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return context.newResponse(response.body, status as StatusCode, headers);
    });
  };
};
