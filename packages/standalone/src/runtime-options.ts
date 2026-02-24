type RuntimeOptionsParams = {
  argv?: readonly string[];
  env?: Record<string, string | undefined>;
};

export type RuntimeOptions = {
  skipSetup: boolean;
  disabledApps: string[];
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const parseBooleanFlag = (value: string | undefined): boolean => {
  if (!value) return false;
  return TRUE_VALUES.has(value.trim().toLowerCase());
};

const parseCsvList = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
};

/**
 * Resolves standalone runtime flags from CLI args and env vars.
 */
export const resolveRuntimeOptions = (params?: RuntimeOptionsParams): RuntimeOptions => {
  const argv = params?.argv ?? process.argv.slice(2);
  const env = params?.env ?? process.env;

  return {
    skipSetup: argv.includes("--skip-setup") || parseBooleanFlag(env.SKIP_SETUP),
    disabledApps: parseCsvList(env.DISABLE_APPS),
  };
};
