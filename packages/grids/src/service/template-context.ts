import { coreSettings } from "@valentinkolb/cloud/services";
import { CLOUD_LOGO_SVG } from "@valentinkolb/cloud/shared";
import type { DocumentProfile } from "../contracts";
import { get as getBase } from "./bases";

export type DocumentTemplateAppData = {
  name: string;
  url: string;
  contactEmail: string | null;
  copyright: string | null;
  timezone: string;
  logoDataUri: string;
};

export type DocumentTemplateBusinessData = {
  legalName: string;
  senderLine: string;
  address: string;
  department: string | null;
  contactEmail: string | null;
  phone: string | null;
  url: string | null;
  taxId: string | null;
  registration: string | null;
  bankName: string | null;
  iban: string | null;
  bic: string | null;
  paymentTerms: string | null;
  footerText: string | null;
};

const stringValue = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const nullableStringValue = (value: unknown): string | null => stringValue(value) || null;
const publicUrlValue = (value: unknown): string => {
  const url = stringValue(value);
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
};

const defaultLogoDataUri = () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(CLOUD_LOGO_SVG)}`;

const appDataFromValues = (values: {
  name?: unknown;
  url?: unknown;
  contactEmail?: unknown;
  copyright?: unknown;
  timezone?: unknown;
  logo?: unknown;
}): DocumentTemplateAppData => ({
  name: stringValue(values.name) || "Cloud",
  url: publicUrlValue(values.url),
  contactEmail: nullableStringValue(values.contactEmail),
  copyright: nullableStringValue(values.copyright),
  timezone: stringValue(values.timezone) || "UTC",
  logoDataUri: stringValue(values.logo) || defaultLogoDataUri(),
});

const appDataFromSettingsSnapshot = (settings?: unknown): DocumentTemplateAppData | null => {
  if (!settings || typeof settings !== "object") return null;
  const app = (settings as { app?: unknown }).app;
  if (!app || typeof app !== "object") return null;
  const appSettings = app as Record<string, unknown>;
  return appDataFromValues({
    name: appSettings.name,
    url: appSettings.url,
    contactEmail: appSettings.contact_email,
    copyright: appSettings.copyright,
    timezone: appSettings.timezone,
    logo: appSettings.logo,
  });
};

export const defaultTemplateAppData = (): DocumentTemplateAppData => appDataFromValues({});

export const buildTemplateAppData = async (settings?: unknown): Promise<DocumentTemplateAppData> => {
  const snapshotData = appDataFromSettingsSnapshot(settings);
  if (snapshotData) return snapshotData;

  const [name, url, contactEmail, copyright, timezone, logo] = await Promise.all([
    coreSettings.get<string>("app.name"),
    coreSettings.get<string>("app.url"),
    coreSettings.get<string>("app.contact_email"),
    coreSettings.get<string>("app.copyright"),
    coreSettings.get<string>("app.timezone"),
    coreSettings.get<string>("app.logo"),
  ]);
  return appDataFromValues({ name, url, contactEmail, copyright, timezone, logo });
};

const documentProfileValue = (profile: DocumentProfile, key: keyof DocumentProfile): string => stringValue(profile[key]);

export const buildTemplateBusinessData = async (
  baseId: string,
  appData: DocumentTemplateAppData = defaultTemplateAppData(),
): Promise<DocumentTemplateBusinessData> => {
  const profile = (await getBase(baseId))?.documentProfile ?? {};
  const legalName = documentProfileValue(profile, "legalName") || appData.name;
  const address = documentProfileValue(profile, "address");
  const senderLine = documentProfileValue(profile, "senderLine") || [legalName, address.replace(/\n/g, " | ")].filter(Boolean).join(" | ");
  return {
    legalName,
    senderLine,
    address,
    department: nullableStringValue(profile.department),
    contactEmail: nullableStringValue(profile.contactEmail) ?? appData.contactEmail,
    phone: nullableStringValue(profile.phone),
    url: nullableStringValue(profile.url) ?? (appData.url || null),
    taxId: nullableStringValue(profile.taxId),
    registration: nullableStringValue(profile.registration),
    bankName: nullableStringValue(profile.bankName),
    iban: nullableStringValue(profile.iban),
    bic: nullableStringValue(profile.bic),
    paymentTerms: nullableStringValue(profile.paymentTerms),
    footerText: nullableStringValue(profile.footerText),
  };
};
