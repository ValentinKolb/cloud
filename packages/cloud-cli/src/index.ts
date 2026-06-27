#!/usr/bin/env bun
import { exec, execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type {
  CloudCliContext,
  CloudCliFlags,
  CloudCliFlagValue,
  CloudCliModule,
  CloudCliOptions,
  CloudCliTableColumn,
} from "@valentinkolb/cloud/cli";
import contactsCliModule from "@valentinkolb/cloud-app-contacts/cli";
import notebooksCliModule from "@valentinkolb/cloud-app-notebooks/cli";
import spacesCliModule from "@valentinkolb/cloud-app-spaces/cli";
import toolsCliModule from "@valentinkolb/cloud-app-tools/cli";
import type { Hono } from "hono";
import { hc } from "hono/client";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

type TokenProviderConfig = {
  token?: string;
  tokenFile?: string;
  tokenCommand?: string;
  fd0?: {
    name: string;
    scope?: string;
  };
};

type CloudCliProfile = TokenProviderConfig & {
  server?: string;
  defaults?: Record<string, string>;
};

type CloudCliConfig = {
  currentProfile?: string;
  profiles?: Record<string, CloudCliProfile>;
};

type ParsedArgs = {
  args: string[];
  flags: CloudCliFlags;
};

type GlobalArgs = {
  profile?: string;
  server?: string;
  token?: string;
  tokenFile?: string;
  tokenCommand?: string;
  fd0?: string;
  fd0Scope?: string;
  output: "text" | "json";
  rest: string[];
};

const DEFAULT_PROFILE = "default";
const CONFIG_PATH =
  process.env.CLD_CONFIG ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cloud", "cld", "config.json");
const TOKEN_TIMEOUT_MS = 10_000;
const BOOLEAN_FLAGS = new Set(["json"]);

const modules: CloudCliModule[] = [contactsCliModule, notebooksCliModule, spacesCliModule, toolsCliModule];

const moduleByName = new Map(modules.map((module) => [module.name, module]));

class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

const isFlag = (value: string | undefined): boolean => Boolean(value?.startsWith("-"));

const setFlag = (flags: CloudCliFlags, name: string, value: CloudCliFlagValue) => {
  const existing = flags[name];
  if (existing === undefined) {
    flags[name] = value;
    return;
  }
  if (Array.isArray(existing)) {
    flags[name] = [...existing, String(value)];
    return;
  }
  flags[name] = [String(existing), String(value)];
};

const parseArgs = (argv: string[], booleanFlags = BOOLEAN_FLAGS): ParsedArgs => {
  const args: string[] = [];
  const flags: CloudCliFlags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]!;
    if (current === "--") {
      args.push(...argv.slice(i + 1));
      break;
    }

    if (!current.startsWith("-") || current === "-") {
      args.push(current);
      continue;
    }

    const flag = current.replace(/^-+/, "");
    const equalsIndex = flag.indexOf("=");
    if (equalsIndex !== -1) {
      setFlag(flags, flag.slice(0, equalsIndex), flag.slice(equalsIndex + 1));
      continue;
    }

    if (booleanFlags.has(flag)) {
      setFlag(flags, flag, true);
      continue;
    }

    const next = argv[i + 1];
    if (next !== undefined && !isFlag(next)) {
      setFlag(flags, flag, next);
      i += 1;
      continue;
    }

    setFlag(flags, flag, true);
  }

  return { args, flags };
};

const takeStringFlag = (flags: CloudCliFlags, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = flags[name];
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.at(-1);
  }
  return undefined;
};

const takeBooleanFlag = (flags: CloudCliFlags, ...names: string[]): boolean => names.some((name) => flags[name] === true);

const parseGlobalArgs = (argv: string[]): GlobalArgs => {
  const global: string[] = [];
  const rest: string[] = [];
  let commandStarted = false;

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]!;
    if (commandStarted) {
      rest.push(current);
      continue;
    }

    if (!current.startsWith("-") || current === "-") {
      commandStarted = true;
      rest.push(current);
      continue;
    }

    global.push(current);
    const flagName = current.replace(/^-+/, "").split("=")[0]!;
    const consumesValue = ["profile", "server", "token", "token-file", "token-command", "fd0", "fd0-scope", "config"].includes(flagName);
    if (consumesValue && !current.includes("=") && argv[i + 1] !== undefined) {
      global.push(argv[i + 1]!);
      i += 1;
    }
  }

  const parsed = parseArgs(global);
  return {
    profile: takeStringFlag(parsed.flags, "profile", "p"),
    server: takeStringFlag(parsed.flags, "server"),
    token: takeStringFlag(parsed.flags, "token"),
    tokenFile: takeStringFlag(parsed.flags, "token-file"),
    tokenCommand: takeStringFlag(parsed.flags, "token-command"),
    fd0: takeStringFlag(parsed.flags, "fd0"),
    fd0Scope: takeStringFlag(parsed.flags, "fd0-scope"),
    output: takeBooleanFlag(parsed.flags, "json") ? "json" : "text",
    rest,
  };
};

const maskToken = (token: string | undefined): string | undefined => {
  if (!token) return undefined;
  if (token.length <= 16) return "********";
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
};

const hasPersistentTokenProvider = (profile: CloudCliProfile): boolean =>
  Boolean(profile.token || profile.tokenFile || profile.tokenCommand || profile.fd0);

const loadConfig = async (): Promise<CloudCliConfig> => {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, "utf8")) as CloudCliConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
};

const saveConfig = async (config: CloudCliConfig): Promise<void> => {
  await mkdir(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(dirname(CONFIG_PATH), 0o700);
  await chmod(CONFIG_PATH, 0o600);
};

const normalizeServer = (server: string): string => server.replace(/\/+$/, "");

const joinUrl = (server: string, path: string): string => `${normalizeServer(server)}${path.startsWith("/") ? path : `/${path}`}`;

const readTokenFile = async (path: string): Promise<string> => (await readFile(path, "utf8")).trim();

const readFd0Token = async (name: string, scope: string | undefined): Promise<string> => {
  const args = ["get", name, "--raw"];
  if (scope) args.push("--scope", scope);
  try {
    const { stdout } = await execFileAsync("fd0", args, { timeout: TOKEN_TIMEOUT_MS });
    const token = stdout.trim();
    if (!token) throw new CliError(`fd0 returned an empty token for "${name}".`);
    return token;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`Failed to read token from fd0: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const readCommandToken = async (command: string): Promise<string> => {
  try {
    const { stdout } = await execAsync(command, { timeout: TOKEN_TIMEOUT_MS });
    const token = stdout.trim();
    if (!token) throw new CliError("Token command returned an empty token.");
    return token;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`Failed to read token from command: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const resolveToken = async (global: GlobalArgs, profile: CloudCliProfile): Promise<string> => {
  if (global.token) return global.token;
  if (process.env.CLD_TOKEN) return process.env.CLD_TOKEN;
  if (global.tokenFile) return readTokenFile(global.tokenFile);
  if (global.fd0) return readFd0Token(global.fd0, global.fd0Scope);
  if (global.tokenCommand) return readCommandToken(global.tokenCommand);
  if (profile.token) return profile.token;
  if (profile.tokenFile) return readTokenFile(profile.tokenFile);
  if (profile.fd0) return readFd0Token(profile.fd0.name, profile.fd0.scope);
  if (profile.tokenCommand) return readCommandToken(profile.tokenCommand);
  throw new CliError("No token configured. Pass --token, set CLD_TOKEN, or configure a profile.");
};

const resolveProfileName = (config: CloudCliConfig, requestedProfile: string | undefined): string => {
  if (requestedProfile) return requestedProfile;
  if (config.currentProfile) return config.currentProfile;
  if (config.profiles?.[DEFAULT_PROFILE]) return DEFAULT_PROFILE;
  const profileNames = Object.keys(config.profiles ?? {});
  if (profileNames.length === 1) return profileNames[0]!;
  return DEFAULT_PROFILE;
};

const resolveOptions = async (global: GlobalArgs): Promise<CloudCliOptions> => {
  const config = await loadConfig();
  const profileName = resolveProfileName(config, global.profile);
  const profile = config.profiles?.[profileName] ?? {};
  const server = global.server ?? process.env.CLD_SERVER ?? profile.server;
  if (!server) throw new CliError("No server configured. Pass --server or run `cld profile set --server <url>`.");
  return {
    profile: profileName,
    server: normalizeServer(server),
    token: await resolveToken(global, profile),
    output: global.output,
  };
};

const resolveOfflineOptions = async (global: GlobalArgs): Promise<CloudCliOptions> => {
  const config = await loadConfig();
  const profileName = resolveProfileName(config, global.profile);
  const profile = config.profiles?.[profileName] ?? {};
  const server = global.server ?? process.env.CLD_SERVER ?? profile.server ?? "";
  return {
    profile: profileName,
    server: server ? normalizeServer(server) : "",
    token: global.token ?? process.env.CLD_TOKEN ?? profile.token ?? "",
    output: global.output,
  };
};

const readJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text().catch(() => "");
  const payload = text.length > 0 ? tryParseJson(text) : null;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: unknown }).error)
          : text.trim() || response.statusText;
    throw new CliError(`${response.status} ${message}`);
  }
  return payload as T;
};

const tryParseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const renderTable = <TRow extends Record<string, unknown>>(rows: TRow[], columns: CloudCliTableColumn<TRow>[]): string => {
  if (rows.length === 0) return "";
  const values = rows.map((row) =>
    columns.map((column) => {
      const value = column.value ? column.value(row) : row[column.key as keyof TRow];
      return value === null || value === undefined ? "" : String(value);
    }),
  );
  const headers = columns.map((column) => column.label ?? String(column.key));
  const widths = headers.map((header, index) => Math.max(header.length, ...values.map((row) => row[index]?.length ?? 0)));
  const renderRow = (row: string[]) =>
    row
      .map((value, index) => value.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return [renderRow(headers), renderRow(widths.map((width) => "-".repeat(width))), ...values.map(renderRow)].join("\n");
};

const createContext = (args: string[], flags: CloudCliFlags, options: CloudCliOptions): CloudCliContext => {
  const headers = { Authorization: `Bearer ${options.token}` };
  return {
    args,
    flags,
    options,
    getDefault: async (key) => {
      const config = await loadConfig();
      return config.profiles?.[options.profile]?.defaults?.[key];
    },
    setDefault: async (key, value) => {
      const config = await loadConfig();
      config.profiles ??= {};
      const profile = config.profiles[options.profile] ?? {};
      const hadPersistentToken = hasPersistentTokenProvider(profile);
      const defaults = { ...(profile.defaults ?? {}) };
      if (value === undefined) delete defaults[key];
      else defaults[key] = value;
      config.profiles[options.profile] = {
        ...profile,
        server: profile.server ?? options.server,
        defaults: Object.keys(defaults).length > 0 ? defaults : undefined,
      };
      await saveConfig(config);
      if (value !== undefined && !hadPersistentToken) {
        console.error(
          `Warning: saved a default for profile "${options.profile}", but this profile has no persistent token provider. Run \`cld profile set ${options.profile} --server ${options.server} --token-file <path>\` or pass a token/env token on future calls.`,
        );
      }
    },
    createApiClient: <TApi extends Hono<any, any, any>>(basePath: string) =>
      hc<TApi>(joinUrl(options.server, basePath), {
        headers,
      }),
    fetch: (path, init = {}) =>
      fetch(joinUrl(options.server, path), {
        ...init,
        headers: {
          ...headers,
          ...(init.headers ?? {}),
        },
      }),
    readJson,
    print: (value = "") => {
      console.log(value);
    },
    json: (value) => {
      console.log(JSON.stringify(value, null, 2));
    },
    table: (rows, columns) => {
      const rendered = renderTable(rows, columns);
      if (rendered) console.log(rendered);
    },
  };
};

const helpText = (): string => `cld

Usage:
  cld [global options] <module> <command> [options]
  cld profile <list|show|use|set> [options]

Global options:
  --profile <name>        Profile name (default: current profile)
  --server <url>          Cloud server URL
  --token <token>         Bearer token
  --token-file <path>     Read bearer token from file
  --fd0 <name>            Read bearer token via fd0 get <name> --raw
  --fd0-scope <scope>     fd0 scope
  --token-command <cmd>   Read bearer token from command stdout
  --json                  Print JSON where supported

Modules:
${modules.map((module) => `  ${module.name.padEnd(12)} ${module.summary}`).join("\n")}

Examples:
  cld --server http://localhost:3000 --token cld_... notebooks list
  cld profile set --server http://localhost:3000 --fd0 cloud-local-token --fd0-scope stuve
  cld notebooks tree <notebook>
`;

const profileHelp = (): string => `cld profile

Usage:
  cld profile list
  cld profile show [name]
  cld profile use <name>
  cld profile set [name] --server <url> [--token <token>]
  cld profile set [name] --server <url> --token-file <path>
  cld profile set [name] --server <url> --fd0 <secret> [--fd0-scope <scope>]
  cld profile set [name] --server <url> --token-command <command>
`;

const runProfileCommand = async (args: string[]): Promise<number> => {
  const [command, maybeName, ...rest] = args;
  if (!command || command === "help") {
    console.log(profileHelp());
    return 0;
  }

  const config = await loadConfig();
  config.profiles ??= {};

  if (command === "list") {
    const currentProfile = resolveProfileName(config, undefined);
    const rows = Object.entries(config.profiles).map(([name, profile]) => ({
      name,
      current: currentProfile === name ? "*" : "",
      server: profile.server ?? "",
      token: profile.token
        ? maskToken(profile.token)
        : profile.fd0
          ? `fd0:${profile.fd0.name}`
          : profile.tokenFile
            ? `file:${profile.tokenFile}`
            : profile.tokenCommand
              ? "command"
              : "",
    }));
    console.log(
      renderTable(rows, [
        { key: "current", label: "" },
        { key: "name", label: "PROFILE" },
        { key: "server", label: "SERVER" },
        { key: "token", label: "TOKEN" },
      ]),
    );
    return 0;
  }

  if (command === "show") {
    const name = resolveProfileName(config, maybeName);
    const profile = config.profiles[name];
    if (!profile) throw new CliError(`Profile "${name}" does not exist.`);
    console.log(
      JSON.stringify(
        {
          name,
          current: resolveProfileName(config, undefined) === name,
          ...profile,
          token: maskToken(profile.token),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (command === "use") {
    if (!maybeName) throw new CliError("Missing profile name.");
    if (!config.profiles[maybeName]) throw new CliError(`Profile "${maybeName}" does not exist.`);
    config.currentProfile = maybeName;
    await saveConfig(config);
    console.log(`Using profile "${maybeName}".`);
    return 0;
  }

  if (command === "set") {
    const name = maybeName && !maybeName.startsWith("-") ? maybeName : (config.currentProfile ?? DEFAULT_PROFILE);
    const flagArgs =
      maybeName && !maybeName.startsWith("-") ? rest : [maybeName, ...rest].filter((value): value is string => Boolean(value));
    const parsed = parseArgs(flagArgs);
    const server = takeStringFlag(parsed.flags, "server");
    const token = takeStringFlag(parsed.flags, "token");
    const tokenFile = takeStringFlag(parsed.flags, "token-file");
    const tokenCommand = takeStringFlag(parsed.flags, "token-command");
    const fd0 = takeStringFlag(parsed.flags, "fd0");
    const fd0Scope = takeStringFlag(parsed.flags, "fd0-scope");

    const existing = config.profiles[name] ?? {};
    const next: CloudCliProfile = {
      ...existing,
      ...(server ? { server: normalizeServer(server) } : {}),
    };
    delete next.token;
    delete next.tokenFile;
    delete next.tokenCommand;
    delete next.fd0;
    if (token) next.token = token;
    if (tokenFile) next.tokenFile = tokenFile;
    if (tokenCommand) next.tokenCommand = tokenCommand;
    if (fd0) next.fd0 = { name: fd0, ...(fd0Scope ? { scope: fd0Scope } : {}) };

    config.profiles[name] = next;
    config.currentProfile ??= name;
    await saveConfig(config);
    console.log(`Saved profile "${name}" to ${CONFIG_PATH}.`);
    return 0;
  }

  throw new CliError(`Unknown profile command "${command}".`);
};

export const main = async (argv = Bun.argv.slice(2)): Promise<number> => {
  const global = parseGlobalArgs(argv);
  const [moduleName, ...moduleArgs] = global.rest;

  if (!moduleName || moduleName === "help" || moduleName === "--help" || moduleName === "-h") {
    console.log(helpText());
    return 0;
  }

  if (moduleName === "profile") return runProfileCommand(moduleArgs);

  const module = moduleByName.get(moduleName);
  if (!module) throw new CliError(`Unknown module "${moduleName}". Run \`cld help\`.`);

  if (moduleArgs[0] === "help" || moduleArgs[0] === "--help" || moduleArgs[0] === "-h") {
    console.log(module.help?.() ?? `${module.name}: ${module.summary}`);
    return 0;
  }

  const parsed = parseArgs(moduleArgs, new Set([...BOOLEAN_FLAGS, ...(module.booleanFlags ?? [])]));
  const resolvedOptions = module.requiresCloud === false ? await resolveOfflineOptions(global) : await resolveOptions(global);
  const options: CloudCliOptions = {
    ...resolvedOptions,
    output: takeBooleanFlag(parsed.flags, "json") ? "json" : resolvedOptions.output,
  };
  const code = await module.run(createContext(parsed.args, parsed.flags, options));
  return code ?? 0;
};

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(error instanceof CliError ? error.exitCode : 1);
    },
  );
}
