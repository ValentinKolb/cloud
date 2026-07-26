const isEditableTarget = (target) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.matches("input, textarea, select, [role='textbox']"));

const searchIsOpen = () => {
  const dialog = document.querySelector("[data-search-dialog]");
  return dialog instanceof HTMLElement && !dialog.classList.contains("hidden");
};

let gotoPending = false;
let gotoTimer;
let toastTimer;

const showShortcut = (text) => {
  let toast = document.querySelector("[data-cloud-shortcut-toast]");
  if (!(toast instanceof HTMLElement)) {
    toast = document.createElement("div");
    toast.className = "cloud-shortcut-toast";
    toast.dataset.cloudShortcutToast = "";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.append(toast);
  }

  toast.textContent = `$ ${text}`;
  toast.dataset.visible = "true";
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.dataset.visible = "false";
  }, 900);
};

const openAfterStatus = (label, href) => {
  showShortcut(`open ${label}`);
  const delay = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180;
  window.setTimeout(() => location.assign(href), delay);
};

addEventListener("keydown", (event) => {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    isEditableTarget(event.target) ||
    searchIsOpen()
  ) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "g") {
    gotoPending = true;
    clearTimeout(gotoTimer);
    gotoTimer = window.setTimeout(() => {
      gotoPending = false;
    }, 1_200);
    return;
  }

  if (!gotoPending) return;
  gotoPending = false;
  clearTimeout(gotoTimer);

  if (key === "d") {
    event.preventDefault();
    const locale = document.documentElement.lang || "en";
    openAfterStatus("developer overview", `/${locale}/overview`);
  } else if (key === "s") {
    event.preventDefault();
    openAfterStatus("source", "https://github.com/ValentinKolb/cloud");
  }
});
