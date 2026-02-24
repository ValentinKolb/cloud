declare module "@valentinkolb/ssr/hono" {
  import type { Context, Env, Handler, Hono, MiddlewareHandler } from "hono";

  type RenderResult = unknown | Promise<unknown>;

  type LooseContext<E extends Env = Env> = Context<E> & {
    get(key: string): any;
  };

  export function routes(config: any): Hono<any>;

  export function createSSRHandler(
    html: any,
  ): <E extends Env = Env>(render: (c: LooseContext<E>) => RenderResult) => [MiddlewareHandler<E>, Handler<E>];
}
