import { defineHelp } from "@valentinkolb/cloud/server";
import setup from "./documents/proxy-auth-setup.help.md" with { type: "text" };
import start from "./documents/proxy-auth-start.help.md" with { type: "text" };
import troubleshoot from "./documents/proxy-auth-troubleshooting.help.md" with { type: "text" };

export const proxyAuthHelp = defineHelp({
  documents: [start, setup, troubleshoot],
});
