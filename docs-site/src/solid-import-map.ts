const joinAsset = (base: string, file: string) => `${base.replace(/\/+$/, "")}/generated/${file}`;

export const renderSolidImportMap = (assetsBase: string) => {
  const solid = joinAsset(assetsBase, "solid.js");
  return `<script type="importmap">${JSON.stringify({
    imports: {
      "solid-js": solid,
      "solid-js/jsx-runtime": solid,
      "solid-js/store": joinAsset(assetsBase, "solid-store.js"),
      "solid-js/web": joinAsset(assetsBase, "solid-web.js"),
    },
  })}</script>`;
};
