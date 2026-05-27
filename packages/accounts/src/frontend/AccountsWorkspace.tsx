import { AppWorkspace } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";
import AccountsNavSidebar, { type AccountsNavActiveKey } from "./AccountsNavSidebar";

type Props = {
  active: AccountsNavActiveKey;
  isAdmin: boolean;
  pendingRequests: number;
  scrollPreserveKey: string;
  children: JSX.Element;
};

export default function AccountsWorkspace(props: Props) {
  return (
    <AppWorkspace class="h-full">
      <AccountsNavSidebar active={props.active} isAdmin={props.isAdmin} pendingRequests={props.pendingRequests} />
      <AppWorkspace.Main>
        <div class="flex-1 min-w-0 min-h-0 overflow-y-auto" data-scroll-preserve={props.scrollPreserveKey}>
          {props.children}
        </div>
      </AppWorkspace.Main>
    </AppWorkspace>
  );
}
