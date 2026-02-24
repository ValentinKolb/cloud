declare module "@valentinkolb/sync" {
  export namespace ratelimit {
    type Options = {
      limit: number;
      windowSecs: number;
      prefix?: string;
    };

    type CheckResult = {
      limited: boolean;
      remaining: number;
      resetIn: number;
    };

    type Client = {
      check: (identifier: string) => Promise<CheckResult>;
      checkOrThrow: (identifier: string) => Promise<CheckResult>;
    };

    export const create: (options: Options) => Client;
    export class RateLimitError extends Error {
      readonly remaining: number;
      readonly resetIn: number;
    }
  }
}
