import { toast } from "@k2b/ui";
import { createSignal } from "solid-js";
import { signOutCurrentSession } from "./account-session";

export default function SignOutButton() {
  const [signingOut, setSigningOut] = createSignal(false);

  const signOut = async () => {
    if (signingOut()) return;
    setSigningOut(true);
    try {
      await signOutCurrentSession();
    } catch (error) {
      setSigningOut(false);
      toast.error(error instanceof Error ? error.message : "Sign out failed. Please try again.");
    }
  };

  return (
    <button type="button" class="btn-secondary btn-sm" disabled={signingOut()} onClick={() => void signOut()}>
      <i class="ti ti-logout" />
      {signingOut() ? "Signing out..." : "Sign Out"}
    </button>
  );
}
