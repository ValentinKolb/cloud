import Tooltip from "./Tooltip";

type RemoveBtnProps = {
  ariaLabel: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
};

export default function RemoveBtn(props: RemoveBtnProps) {
  return (
    <Tooltip content={props.ariaLabel}>
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.disabled || props.loading}
        class="group/rm focus-ui flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors hover:bg-red-500/[0.08] disabled:opacity-50"
        aria-label={props.ariaLabel}
      >
        {props.loading ? (
          <i class="ti ti-loader-2 animate-spin text-sm text-zinc-400" />
        ) : (
          <>
            <i class="ti ti-x text-sm text-zinc-400 group-hover/rm:hidden" />
            <i class="ti ti-trash hidden text-sm text-red-500 group-hover/rm:inline" />
          </>
        )}
      </button>
    </Tooltip>
  );
}
