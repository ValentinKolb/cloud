// Cross-app ambient module declarations. Every app's tsconfig includes this
// so apps can import non-TS assets (e.g. `import md from './x.md' with { type: "text" }`)
// without re-declaring the stub per-package.

declare module "*.md" {
  const content: string;
  export default content;
}
