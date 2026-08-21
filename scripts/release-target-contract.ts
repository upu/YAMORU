export type ReleaseTarget = {
  headCommit: string;
  isOnMain: boolean;
  tagCommit: string;
  tagName: string;
};

const STABLE_SEMVER_TAG = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

export function assertStableReleaseTag(tagName: string): void {
  if (!STABLE_SEMVER_TAG.test(tagName)) {
    throw new Error("production ReleaseにはvX.Y.Z形式のstable SemVer tagが必要です。");
  }
}

export function assertReleaseTarget(target: ReleaseTarget): void {
  assertStableReleaseTag(target.tagName);
  if (target.tagCommit !== target.headCommit) {
    throw new Error("Release tag commitとcheckout済みHEADが一致しません。");
  }
  if (!target.isOnMain) {
    throw new Error("production Releaseのcommitはmainに含まれている必要があります。");
  }
}
