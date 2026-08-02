import { CopyButton as BaseCopyButton, type CopyButtonProps } from "@k2b/ui";

type Props = {
  text: string;
  class?: CopyButtonProps["class"];
  label?: CopyButtonProps["label"];
  size?: CopyButtonProps["size"];
  variant?: CopyButtonProps["variant"];
};

/**
 * Island wrapper so CopyButton stays interactive when rendered from SSR-only host rows.
 */
const CopyButton = (props: Props) => {
  return <BaseCopyButton text={props.text} label={props.label} class={props.class} size={props.size} variant={props.variant} />;
};

export default CopyButton;
