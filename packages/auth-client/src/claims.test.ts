import { describe, expect, it } from "vitest";
import { parseLumorphiaClaims } from "./claims.ts";

const profile = {
  sub: "test-sub",
  "https://lumorphia.com/handle": "test_handle",
  "https://lumorphia.com/legacy_pending": ["prismtone"],
};

describe("parseLumorphiaClaims", () => {
  it("reads the stable subject and namespaced claims", () => {
    expect(parseLumorphiaClaims(profile)).toEqual({
      sub: "test-sub",
      handle: "test_handle",
      legacyPending: ["prismtone"],
    });
  });
  it.each([
    null,
    [],
    {},
    { ...profile, sub: 1 },
    { ...profile, sub: "" },
    { ...profile, "https://lumorphia.com/handle": null },
    { ...profile, "https://lumorphia.com/legacy_pending": "prismtone" },
    { ...profile, "https://lumorphia.com/legacy_pending": [1] },
  ])("rejects malformed claims %j", (value) => {
    expect(() => parseLumorphiaClaims(value)).toThrow();
  });
  it("ignores identities unless their scope was requested", () => {
    expect(
      parseLumorphiaClaims({ ...profile, "https://lumorphia.com/identities": "invalid" }),
    ).not.toHaveProperty("identities");
  });
  it("reads identities when their scope was requested", () => {
    expect(
      parseLumorphiaClaims(
        {
          ...profile,
          "https://lumorphia.com/identities": [{ provider: "discord", id: "test-id" }],
        },
        { identities: true },
      ).identities,
    ).toEqual([{ provider: "discord", id: "test-id" }]);
  });
  it.each([undefined, {}, [{ provider: "discord", id: 1 }], [{ provider: "", id: "test-id" }]])(
    "rejects malformed requested identities %j",
    (identities) => {
      expect(() =>
        parseLumorphiaClaims(
          { ...profile, "https://lumorphia.com/identities": identities },
          { identities: true },
        ),
      ).toThrow();
    },
  );
  it("copies claim arrays so adapters cannot mutate the profile", () => {
    expect(parseLumorphiaClaims(profile).legacyPending).not.toBe(
      profile["https://lumorphia.com/legacy_pending"],
    );
  });
});
