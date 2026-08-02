import { Avatar, type AvatarSize } from "@k2b/ui";
import type { JSX } from "solid-js";

type Props = {
  name: string;
  userId?: string | null;
  avatarHash?: string | null;
  size?: AvatarSize;
  class?: string;
  style?: JSX.CSSProperties | string;
};

/** Adapts Accounts avatar revisions to the portable visual primitive. */
export default function AccountAvatar(props: Props) {
  const label = () => props.name.trim() || "?";
  const source = () =>
    props.userId && props.avatarHash
      ? `/api/accounts/users/${encodeURIComponent(props.userId)}/avatar?rev=${encodeURIComponent(props.avatarHash)}`
      : undefined;

  return (
    <Avatar
      name={label()}
      src={source()}
      fallback={label().slice(0, 2).toUpperCase()}
      size={props.size}
      class={props.class}
      style={props.style}
    />
  );
}
