import { buildFontAssets } from "./font-assets";
import { buildTablerIconAssets } from "./tabler-assets";

const root = process.env.WORKSPACE_ROOT!;
const publicDir = process.env.PUBLIC_DIR!;

await buildFontAssets(root, publicDir);
await buildTablerIconAssets(root, publicDir);
