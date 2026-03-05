type Props = {
  variant?: "chip" | "sidebar";
};

export default function SpaceSearchButton(props: Props) {
  const handleClick = () => {
    const input = document.querySelector("input[placeholder='Search tasks, people, tags...']") as HTMLInputElement | null;
    if (!input) return;
    input.scrollIntoView({ block: "nearest", behavior: "smooth" });
    input.focus();
  };

  if (props.variant === "sidebar") {
    return (
      <button type="button" onClick={handleClick} class="sidebar-item w-full min-h-8 px-2 py-1.5 text-xs bg-zinc-200/60 dark:bg-zinc-800/60">
        <i class="ti ti-search" />
        <span>Search</span>
      </button>
    );
  }

  return (
    <button type="button" onClick={handleClick} class="btn-input btn-input-sm bg-zinc-200/60 dark:bg-zinc-800/60">
      <i class="ti ti-search" />
      <span>Search</span>
    </button>
  );
}

