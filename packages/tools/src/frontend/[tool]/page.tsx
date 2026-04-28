import { ssr } from "../../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import type { JSX } from "solid-js";
import { toolById } from "../tools/registry";
import MailtoGenerator from "../tools/MailtoGenerator.island";
import QrCodeGenerator from "../tools/QrCodeGenerator.island";
import EncodingTool from "../tools/EncodingTool.island";
import UuidGenerator from "../tools/UuidGenerator.island";
import HashGenerator from "../tools/HashGenerator.island";
import LoremIpsumGenerator from "../tools/LoremIpsumGenerator.island";
import ColorConverter from "../tools/ColorConverter.island";
import ImageProcessor from "../tools/ImageProcessor.island";
import EncryptionTool from "../tools/EncryptionTool.island";
import PasswordGenerator from "../tools/PasswordGenerator.island";

const toolComponents: Record<string, () => JSX.Element> = {
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
};

export default ssr<AuthContext>(async (c) => {
  const toolId = c.req.param("toolId");
  const tool = toolById(toolId);

  if (!tool) {
    return c.redirect("/tools", 302);
  }

  const renderTool = toolComponents[tool.id];
  const breadcrumbs = [{ title: "Start", href: "/" }, { title: "Tools", href: "/tools" }, { title: tool.name }];

  // Image processor gets fullscreen layout
  if (tool.id === "image") {
    return () => (
      <Layout c={c} fullPage title={breadcrumbs}>
        <ImageProcessor />
      </Layout>
    );
  }

  return () => (
    <Layout c={c} title={breadcrumbs}>
      <div class="max-w-4xl mx-auto">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 thumbnail bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
            <i class={`${tool.icon} text-xl text-zinc-600 dark:text-zinc-400`} />
          </div>
          <div>
            <h1 class="text-lg font-semibold">{tool.name}</h1>
            <p class="text-xs text-dimmed">{tool.description}</p>
          </div>
        </div>
        {renderTool ? renderTool() : null}
      </div>
    </Layout>
  );
});
