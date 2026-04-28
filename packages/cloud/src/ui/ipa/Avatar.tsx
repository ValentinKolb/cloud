type AvatarSize = "sm" | "md" | "lg" | "xl";

type AvatarProps = {
  username: string;
  size?: AvatarSize;
  class?: string;
};

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-lg",
  xl: "h-20 w-20 text-xl",
};

/** Displays a user avatar with initials. */
export default function Avatar(props: AvatarProps) {
  const sizeClass = SIZE_CLASSES[props.size ?? "md"];
  const initials = props.username.slice(0, 2).toUpperCase();

  return (
    <div
      class={`flex shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 font-semibold text-zinc-600 dark:text-zinc-300 ${sizeClass} ${props.class ?? ""}`}
    >
      {initials}
    </div>
  );
}
