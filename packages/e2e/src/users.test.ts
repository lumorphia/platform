import { describe, expect, it } from "vitest";
import { lumorphiaUser } from "./users.ts";

describe("lumorphiaUser", () => {
  it("gives each test its own user", () => {
    const [a, b] = [lumorphiaUser(), lumorphiaUser()];
    expect(a.sub).not.toBe(b.sub);
    expect(a.sid).not.toBe(b.sid);
    expect(a.handle).not.toBe(b.handle);
  });

  it("makes a handle accounts would accept", () => {
    expect(lumorphiaUser().handle).toMatch(/^[a-z0-9_]{3,20}$/);
  });

  it("names the user so it stands out from real ones", () => {
    expect(lumorphiaUser().name).toMatch(/^テスト_/);
  });

  it("lets the test choose any field", () => {
    expect(lumorphiaUser({ name: "テスト_別名" }).name).toBe("テスト_別名");
  });
});
