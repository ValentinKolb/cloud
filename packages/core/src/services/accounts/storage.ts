import type { UserProfile, UserProvider } from "@valentinkolb/cloud-contracts/shared";

export type StoredRealm = "ipa" | "ipa-limited" | "guest" | "local";

export const storedRealmFromProviderProfile = (provider: UserProvider, profile: UserProfile): StoredRealm => {
  if (provider === "ipa") return profile === "user" ? "ipa" : "ipa-limited";
  return profile === "user" ? "local" : "guest";
};

export const storedExpiryColumnsFromAccountExpiry = (params: {
  provider: UserProvider;
  profile: UserProfile;
  accountExpires: Date | null;
}): {
  ipaAccountExpires: Date | null;
  guestExpiresAt: Date | null;
} => {
  if (params.provider === "ipa") {
    return {
      ipaAccountExpires: params.accountExpires,
      guestExpiresAt: null,
    };
  }

  return {
    ipaAccountExpires: null,
    guestExpiresAt: params.profile === "guest" ? params.accountExpires : null,
  };
};

export const storedAccountColumnsFromCanonical = (params: {
  provider: UserProvider;
  profile: UserProfile;
  accountExpires: Date | null;
}): {
  realm: StoredRealm;
  ipaAccountExpires: Date | null;
  guestExpiresAt: Date | null;
} => ({
  realm: storedRealmFromProviderProfile(params.provider, params.profile),
  ...storedExpiryColumnsFromAccountExpiry(params),
});
