export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

export type AvatarProps = {
  username: string;
  userId?: string | null;
  avatarHash?: string | null;
  size?: AvatarSize;
  class?: string;
  style?: string;
};

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-lg",
  xl: "h-20 w-20 text-xl",
};

/** Displays a cached user avatar image with stable initials fallback. */
export default function Avatar(props: AvatarProps) {
  const sizeClass = SIZE_CLASSES[props.size ?? "md"];
  const label = props.username.trim() || "?";
  const initials = label.slice(0, 2).toUpperCase();
  const className = `flex shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 font-semibold text-zinc-600 dark:text-zinc-300 ${sizeClass} ${props.class ?? ""}`;

  if (props.userId && props.avatarHash) {
    const src = `/api/accounts/users/${encodeURIComponent(props.userId)}/avatar?rev=${encodeURIComponent(props.avatarHash)}`;
    return <img src={src} alt={`${label} avatar`} class={`${className} object-cover`} style={props.style} loading="lazy" decoding="async" />;
  }

  return (
    <div class={className} style={props.style} aria-label={`${label} avatar`}>
      {initials}
    </div>
  );
}
