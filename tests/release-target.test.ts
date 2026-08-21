import { describe, expect, it } from "vitest";

import { assertReleaseTarget } from "../scripts/release-target-contract";

const VALID_TARGET = {
  headCommit: "1111111111111111111111111111111111111111",
  isOnMain: true,
  tagCommit: "1111111111111111111111111111111111111111",
  tagName: "v0.3.0",
};

describe("production Release target", () => {
  it.each(["v0.3.0", "v1.0.0", "v12.34.56"])(
    "stable SemVer tag %sを受け付ける",
    (tagName) => {
      expect(() => {
        assertReleaseTarget({ ...VALID_TARGET, tagName });
      }).not.toThrow();
    },
  );

  it.each(["0.3.0", "v0.3", "v0.3.0-rc.1", "latest", "v01.2.3"])(
    "stable SemVerでないtag %sを拒否する",
    (tagName) => {
      expect(() => {
        assertReleaseTarget({ ...VALID_TARGET, tagName });
      }).toThrow(
        /stable SemVer/u,
      );
    },
  );

  it("tagとcheckout済みHEADが異なる場合は拒否する", () => {
    expect(() => {
      assertReleaseTarget({
        ...VALID_TARGET,
        headCommit: "2222222222222222222222222222222222222222",
      });
    }).toThrow(/tag commit/u);
  });

  it("mainに含まれないcommitを拒否する", () => {
    expect(() => {
      assertReleaseTarget({ ...VALID_TARGET, isOnMain: false });
    }).toThrow(/main/u);
  });
});
