import { Button, toast } from "@k2b/ui";
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
    <Button type="button" variant="secondary" size="sm" loading={signingOut()} loadingLabel="Signing out" onClick={() => void signOut()}>
      <i class="ti ti-logout" />
      Sign Out
    </Button>
  );
}
