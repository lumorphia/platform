import { describe, expect, it } from "vitest";
import { formatConsentVersion, needsReconsent, parseConsentVersion } from "./versions.ts";

const current = { terms: "1.3", privacy: "2.1" };

describe("consent version strings", () => {
  it("round-trips the versions of both documents", () => {
    expect(parseConsentVersion(formatConsentVersion(current))).toEqual(current);
  });

  it.each(["", "1.0", "terms=1.0", null, undefined])("reads %j as no record", (value) => {
    expect(parseConsentVersion(value)).toBeNull();
  });
});

describe("needsReconsent", () => {
  it("asks again when there is no record", () => {
    expect(needsReconsent(null, current)).toBe(true);
  });

  it("does not ask again for a minor revision", () => {
    expect(needsReconsent({ terms: "1.0", privacy: "2.0" }, current)).toBe(false);
  });

  it("asks again when the terms get a new major version", () => {
    expect(needsReconsent({ terms: "1.0", privacy: "2.1" }, { terms: "2.0", privacy: "2.1" })).toBe(
      true,
    );
  });

  it("asks again when the privacy policy gets a new major version", () => {
    expect(needsReconsent({ terms: "1.3", privacy: "1.0" }, current)).toBe(true);
  });

  it("asks again when an accepted version cannot be read", () => {
    expect(needsReconsent({ terms: "x", privacy: "2.1" }, current)).toBe(true);
  });
});
