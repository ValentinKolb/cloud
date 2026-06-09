import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import type { JSX } from "solid-js";
import { resolveSpeedtestBase } from "../../api/_url";
import { ssr } from "../../config";
import ToolsLayoutHelp from "../_components/help/ToolsLayoutHelp.island";
import { ToolsWorkspace } from "../ToolsWorkspace";
import ColorConverter from "../tools/ColorConverter.island";
import EncodingTool from "../tools/EncodingTool.island";
import EncryptionTool from "../tools/EncryptionTool.island";
import HashGenerator from "../tools/HashGenerator.island";
import ImageProcessor from "../tools/ImageProcessor.island";
import LoremIpsumGenerator from "../tools/LoremIpsumGenerator.island";
import MailtoGenerator from "../tools/MailtoGenerator.island";
import PasswordGenerator from "../tools/PasswordGenerator.island";
import QrCodeGenerator from "../tools/QrCodeGenerator.island";
import { toolById } from "../tools/registry";
import SpeedTest from "../tools/SpeedTest.island";
import UuidGenerator from "../tools/UuidGenerator.island";
import WebhookTester, { parseWebhookTesterState, type WebhookTesterInitialState } from "../tools/WebhookTester.island";

const toolComponents: Record<
  string,
  (props: { speedtestBase?: string; webhookState?: WebhookTesterInitialState; baseHref?: string }) => JSX.Element
> = {
  mailto: () => <MailtoGenerator />,
  qr: () => <QrCodeGenerator />,
  encoding: () => <EncodingTool />,
  uuid: () => <UuidGenerator />,
  hash: () => <HashGenerator />,
  lorem: () => <LoremIpsumGenerator />,
  color: () => <ColorConverter />,
  image: () => <ImageProcessor />,
  encryption: () => <EncryptionTool />,
  password: () => <PasswordGenerator />,
  speedtest: (props) => <SpeedTest cliBaseUrl={props.speedtestBase} />,
  webhooks: (props) => <WebhookTester initialState={props.webhookState} baseHref={props.baseHref} />,
};

export default ssr<AuthContext>(async (c) => {
  const toolId = c.req.param("toolId");
  if (!toolId) {
    return c.redirect("/tools", 302);
  }
  const tool = toolById(toolId);

  if (!tool) {
    return c.redirect("/tools", 302);
  }

  const renderTool = toolComponents[tool.id];
  const speedtestBase = tool.id === "speedtest" ? resolveSpeedtestBase(c) : undefined;
  const webhookState = tool.id === "webhooks" ? parseWebhookTesterState(new URL(c.req.url)) : undefined;
  const breadcrumbs = [{ title: "Start", href: "/" }, { title: "Tools", href: "/tools" }, { title: tool.name }];

  return () => (
    <Layout c={c} fullPage title={breadcrumbs}>
      <ToolsLayoutHelp />
      <ToolsWorkspace activeToolId={tool.id}>
        <div
          class={
            tool.id === "image" || tool.id === "webhooks" ? "flex min-h-0 flex-1 flex-col" : "mx-auto flex w-full max-w-5xl flex-col gap-4"
          }
        >
          <ShowToolHeader
            show={tool.id !== "image" && tool.id !== "webhooks"}
            icon={tool.icon}
            name={tool.name}
            description={tool.description}
          />
          {renderTool ? renderTool({ speedtestBase, webhookState, baseHref: `/tools/${tool.id}` }) : null}
        </div>
      </ToolsWorkspace>
    </Layout>
  );
});

const ShowToolHeader = (props: { show: boolean; icon: string; name: string; description: string }) =>
  props.show ? (
    <header class="flex items-center gap-3">
      <div class="thumbnail flex h-10 w-10 items-center justify-center bg-zinc-100 dark:bg-zinc-800">
        <i class={`${props.icon} text-xl text-zinc-600 dark:text-zinc-400`} />
      </div>
      <div class="min-w-0">
        <h1 class="text-lg font-semibold">{props.name}</h1>
        <p class="text-xs text-dimmed">{props.description}</p>
      </div>
    </header>
  ) : null;
