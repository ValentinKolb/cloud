import { Dropdown } from "@valentinkolb/cloud-lib/ui";

/** Small dropdown for legal links (Impressum, AGB) in the rail nav. */
export default function LegalDropdown() {
  return (
    <Dropdown
      trigger={
        <span class="hover-text flex items-center justify-center w-8 h-8 transition-colors" title="Legal">
          <i class="ti ti-dots-vertical text-base" />
        </span>
      }
      position="top-right"
      width="w-44"
      elements={[
        {
          icon: "ti ti-file-text",
          label: "Impressum",
          href: "/impressum",
        },
        {
          icon: "ti ti-file-text",
          label: "AGB",
          href: "/legal/agb",
        },
      ]}
    />
  );
}
