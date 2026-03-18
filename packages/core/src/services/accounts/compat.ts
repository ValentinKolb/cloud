import type { UserProfile, UserProvider } from "@valentinkolb/cloud-contracts/shared";

export type LegacyRealm = "ipa" | "ipa-limited" | "guest" | "local";

export const providerProfileFromRealm = (realm: string | null | undefined): { provider: UserProvider; profile: UserProfile } => {
  switch (realm) {
    case "ipa":
      return { provider: "ipa", profile: "user" };
    case "ipa-limited":
      return { provider: "ipa", profile: "guest" };
    case "local":
      return { provider: "local", profile: "user" };
    case "guest":
    default:
      return { provider: "local", profile: "guest" };
  }
};

export const realmFromProviderProfile = (provider: UserProvider, profile: UserProfile): LegacyRealm => {
  if (provider === "ipa") return profile === "user" ? "ipa" : "ipa-limited";
  return profile === "user" ? "local" : "guest";
};

export const legacyExpiryColumnsFromAccountExpiry = (params: {
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

export const legacyAccountColumnsFromCanonical = (params: {
  provider: UserProvider;
  profile: UserProfile;
  accountExpires: Date | null;
}): {
  realm: LegacyRealm;
  ipaAccountExpires: Date | null;
  guestExpiresAt: Date | null;
} => ({
  realm: realmFromProviderProfile(params.provider, params.profile),
  ...legacyExpiryColumnsFromAccountExpiry(params),
});
