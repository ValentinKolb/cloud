import { command, defineCliCommands, flag, type CloudCliContext } from "./index";

type VisibleApp = {
  id: string;
  name: string;
  description: string;
  icon: string;
  href: string;
};

const listApps = async (ctx: CloudCliContext, search: string | undefined) => {
  const query = search ? `?${new URLSearchParams({ search }).toString()}` : "";
  return ctx.readJson<{ items: VisibleApp[] }>(await ctx.fetch(`/api/apps${query}`));
};

export default defineCliCommands({
  name: "apps",
  summary: "List Cloud apps available to the current user.",
  commands: [
    command("list", {
      summary: "List available Cloud apps",
      flags: {
        search: flag.string({ aliases: ["q"], description: "Filter by app name, id, or description" }),
      },
      run: async ({ ctx, flags }) => {
        const result = await listApps(ctx, flags.search);
        if (ctx.options.output === "json") {
          ctx.json(result);
          return;
        }
        ctx.table(result.items, [
          { key: "id", label: "ID" },
          { key: "name", label: "NAME" },
          { key: "description", label: "DESCRIPTION" },
          { key: "href", label: "URL" },
        ]);
      },
    }),
  ],
});
