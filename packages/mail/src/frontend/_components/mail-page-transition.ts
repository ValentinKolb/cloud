const activePageTransition = (): boolean => {
  try {
    return document.documentElement.matches(":active-view-transition");
  } catch {
    return false;
  }
};

export const waitForMailPageTransition = async (): Promise<void> => {
  if (typeof document === "undefined") return;
  const deadline = performance.now() + 2_000;
  await new Promise<void>((resolve) => {
    const check = () => {
      if (!activePageTransition() || performance.now() >= deadline) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
};
