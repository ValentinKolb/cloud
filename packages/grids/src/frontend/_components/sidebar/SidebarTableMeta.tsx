import { AppWorkspace } from "@valentinkolb/cloud/ui";

export default function SidebarTableMeta(props: { tableName: string }) {
  return (
    <AppWorkspace.SidebarItemMeta>
      <span class="block max-w-20 truncate text-[9px] uppercase tracking-wider" title={props.tableName}>
        {props.tableName}
      </span>
    </AppWorkspace.SidebarItemMeta>
  );
}
