import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { buildDesktopLab } from "./build";
import { createDesktopLabService } from "./main/service";

const packageRoot = resolve(import.meta.dir, "..");
const dist = resolve(packageRoot, "dist", "renderer");
const requestedPort = Number(process.env.PORT ?? 3030);
const service = createDesktopLabService({ dataDir: resolve(packageRoot, ".local") });

if (!existsSync(join(dist, "index.html"))) {
  await buildDesktopLab();
}

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

const readBody = async (req: Request) => {
  if (req.headers.get("content-type")?.includes("application/json")) {
    return req.json().catch(() => ({}));
  }
  return {};
};

const callBridge = async (path: string, body: any) => {
  const nativeOnly = (label: string) => ({
    ok: false,
    error: `${label} requires the native Electrobun runtime. The browser harness is still running safely.`,
  });

  switch (path) {
    case "state":
      return service.getState();
    case "desktop-environment":
      return {
        ok: true,
        data: {
          runtime: "browser",
          platform: "browser",
          windowControls: "browser",
          supportsNativeDialogs: false,
          supportsNativeMenus: false,
          supportsContextMenus: false,
        },
      };
    case "markdown-workspace":
      return service.getMarkdownWorkspace();
    case "markdown-folder-add":
      return nativeOnly("Adding folders");
    case "markdown-folder-remove":
      return service.removeMarkdownFolder(body);
    case "markdown-rescan":
      return service.rescanMarkdownFolders();
    case "markdown-file-read":
      return service.readMarkdownFile(body);
    case "markdown-file-save":
      return service.saveMarkdownFile(body);
    case "markdown-file-create":
      return service.createMarkdownFile(body);
    case "markdown-file-rename":
      return service.renameMarkdownFile(body);
    case "markdown-file-delete":
      return service.deleteMarkdownFile(body);
    case "mode":
      return service.setMode(body);
    case "local-note":
      return service.saveLocalNote(body);
    case "connect-cloud":
      return service.connectCloud(body);
    case "disconnect-cloud":
      return service.disconnectCloud();
    case "sync-now":
      return service.syncNow();
    case "native-open-file":
      return nativeOnly("Native file dialogs");
    case "native-message":
      return nativeOnly("Native message boxes");
    case "native-notification":
      return nativeOnly("Native notifications");
    case "native-clipboard-write":
    case "native-clipboard-read":
      return nativeOnly("Native clipboard access");
    case "native-context-menu":
      return nativeOnly("Native context menus");
    case "native-open-external":
      return nativeOnly("Native external URL opening");
    case "native-window-close":
    case "native-window-minimize":
    case "native-window-maximize":
      return nativeOnly("Native window controls");
    default:
      return { ok: false, error: `Unknown bridge method: ${path}` };
  }
};

const fetch = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  if (url.pathname.startsWith("/bridge/")) {
    if (req.method !== "POST") return json({ ok: false, error: "Bridge only accepts POST" }, 405);
    const body = await readBody(req);
    return json(await callBridge(url.pathname.slice("/bridge/".length), body));
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = resolve(dist, `.${pathname}`);
  if (!filePath.startsWith(dist)) return new Response("Not found", { status: 404 });
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    const fallback = Bun.file(join(dist, "index.html"));
    if (await fallback.exists()) return new Response(fallback);
    return new Response("Not found", { status: 404 });
  }
  return new Response(file);
};

const startServer = (startPort: number) => {
  for (let candidate = startPort; candidate < startPort + 20; candidate++) {
    try {
      return Bun.serve({ port: candidate, fetch });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Failed to start server")) throw error;
    }
  }
  return Bun.serve({ port: 0, fetch });
};

const server = startServer(requestedPort);

const shutdown = () => {
  service.close();
  server.stop();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(`Markdown Desk running at http://localhost:${server.port}`);
