import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  type CapabilityExecutionContext,
  UniversalSearchDataSchema,
  UniversalSearchInputSchema,
  type User,
} from "@valentinkolb/cloud/contracts";
import { filesCapabilities } from "./capabilities";
import { filesService } from "./service";

const user: User = {
  id: "11111111-1111-4111-8111-111111111111",
  uid: "files-capability",
  roles: ["user", "ipa", "ipa/user"],
  provider: "ipa",
  profile: "user",
  givenname: "Files",
  sn: "Capability",
  displayName: "Files Capability",
  mail: "files-capability@example.test",
  avatarHash: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: [],
  manages: [],
  managesGroupIds: [],
  ipa: {
    uidNumber: null,
    phone: null,
    employeeType: null,
    mobile: null,
    address: { street: null, postalCode: null, city: null, state: null },
    passwordExpires: null,
    lastLoginIpa: null,
    syncedAt: null,
    sshPublicKeys: [],
    sshFingerprints: [],
  },
};

const context: CapabilityExecutionContext = {
  actor: { kind: "user", user },
  accessSubject: { type: "user", userId: user.id },
  user,
  signal: new AbortController().signal,
};

afterEach(() => mock.restore());

describe("files capabilities", () => {
  test("declares the registered, navigable search surface", () => {
    expect(Object.keys(filesCapabilities.types).sort()).toEqual(["directory", "file"]);
    expect(Object.keys(filesCapabilities.queries)).toEqual(["search"]);
    expect(filesCapabilities.queries.search.input).toBe(UniversalSearchInputSchema);
    expect(filesCapabilities.queries.search.data).toBe(UniversalSearchDataSchema);
  });

  test("returns stable open and preview links for matching files", async () => {
    spyOn(filesService.base, "listResolved").mockResolvedValue([{ type: "home", uid: user.uid }]);
    spyOn(filesService.search, "list").mockResolvedValue({
      ok: true,
      data: {
        results: [
          {
            base: { type: "home", id: user.uid, name: "Home" },
            files: [{ type: "file", name: "avatar.png", path: "/Pictures/avatar.png", mimeType: "image/png" }],
          },
        ],
      },
    } as Awaited<ReturnType<typeof filesService.search.list>>);

    const result = await filesCapabilities.queries.search.run({ query: "avatar", tags: [], limit: 10 }, context);

    expect(result).toMatchObject({
      ok: true,
      data: {
        data: [
          {
            ref: { type: "files.file", id: "home:files-capability:/Pictures/avatar.png" },
            links: [
              { rel: "open", href: "/app/files/home/Pictures/avatar.png" },
              {
                rel: "preview",
                href: "/api/files/home/files-capability/thumbnail?path=%2FPictures%2Favatar.png",
              },
            ],
          },
        ],
      },
    });
  });
});
