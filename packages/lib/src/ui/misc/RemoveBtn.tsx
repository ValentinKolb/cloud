type RemoveBtnProps = {
  ariaLabel: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
};

export default function RemoveBtn(props: RemoveBtnProps) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled || props.loading}
      class="p-1.5 shrink-0 transition-colors disabled:opacity-50 group/rm"
      aria-label={props.ariaLabel}
    >
      {props.loading ? (
        <i class="ti ti-loader-2 animate-spin text-sm text-zinc-400" />
      ) : (
        <>
          <i class="ti ti-x text-sm text-zinc-400 group-hover/rm:hidden" />
          <i class="ti ti-trash text-sm text-red-500 hidden group-hover/rm:inline" />
        </>
      )}
    </button>
  );
}
