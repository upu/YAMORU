import { readHouseholdVersion } from "../../../lib/d1/conversation-read";
import { CommandError, invalidInput, type CommandPreview } from "./contract";

// 変更操作の競合検出に使う家庭の世代(YDR-053)。読み取りToolが返すrevision
// (`[1, kind, id, epoch, version]`のJSON文字列)と同じ世代を使い、previewを
// 作ったときの世代をcommitのbatch内で照合する。対象ごとの世代ではないため、
// 家族による無関係な更新でもpreviewは古くなる(保守的な方式)。

export type HouseholdRevision = { epoch: string; version: number };

export async function currentRevision(db: D1Database, householdId: string): Promise<HouseholdRevision> {
  const { epoch, version } = await readHouseholdVersion(db, householdId);
  return { epoch, version };
}

export function sameRevision(left: HouseholdRevision, right: HouseholdRevision): boolean {
  return left.epoch === right.epoch && left.version === right.version;
}

export type ExpectedRevision = HouseholdRevision & { id: string; kind: string };

export function parseExpectedRevision(value: unknown): ExpectedRevision {
  let parsed: unknown = null;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : null;
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 5) throw invalidInput("expected_revision", "invalid_revision");
  const [format, kind, id, epoch, version] = parsed as unknown[];
  if (
    format !== 1 || typeof kind !== "string" || typeof id !== "string" || typeof epoch !== "string" ||
    typeof version !== "number" || !Number.isInteger(version) || version < 1
  ) {
    throw invalidInput("expected_revision", "invalid_revision");
  }
  return { epoch, id, kind, version };
}

// 利用者が読み取った時点のrevisionで確認したい場合の照合。revisionは操作の
// 影響を受ける対象のものに限り、世代が進んでいればstale_previewにする。
export function checkExpectedRevision(
  expected: ExpectedRevision,
  current: HouseholdRevision,
  preview: CommandPreview,
): void {
  const affected = preview.affected_entities.some((entity) => entity.kind === expected.kind && entity.id === expected.id);
  if (!affected) throw invalidInput("expected_revision", "not_affected_entity");
  if (!sameRevision(expected, current)) throw new CommandError("stale_preview");
}
