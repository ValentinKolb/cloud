import { buildFontAssets } from "./font-assets";
import { buildTablerIconAssets } from "./tabler-assets";

const publicDir = process.env.PUBLIC_DIR!;

await buildFontAssets(publicDir);
await buildTablerIconAssets(publicDir);
