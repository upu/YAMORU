import {
  CONFIRMATION_CHAIN_WINDOW_MS,
  findSubjectChainHead,
} from "../../../lib/d1/integration-confirmations";
import type { IntegrationOperation, OperationConfirmation } from "../../../lib/d1/integration-operations";
import { canonicalJson, sha256Hex, type CommandPreview, type NormalizedCommand } from "./contract";

// 追加確認(YDR-062)。古いpreviewを作り直した結果、利用者が同意した内容から
// 意味のある差分が出た操作だけ、YAMORUの確認画面での本人の承認を必須にする。

export const CONFIRMATION_PATH_PREFIX = "/settings/integrations/operations";
export const CHANGED_AFTER_STALE_PREVIEW = "changed_after_stale_preview";

function withoutKeys(value: unknown, drop: (key: string) => boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => withoutKeys(item, drop));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !drop(key))
      .map(([key, item]) => [key, withoutKeys(item, drop)]));
  }
  return value;
}

// 何に対する操作か。対象を持つcommandは対象、登録系はprepare時刻を除いた正規化
// payloadから作る。同じ本人・家庭・subject_keyの記録で、作り直しの対応を追う。
export async function subjectKeyOf(normalized: NormalizedCommand): Promise<string> {
  if (normalized.target !== null) return `${normalized.command}|${normalized.target.kind}:${normalized.target.id}`;
  const payload = withoutKeys(normalized.payload, (key) => key === "reference_at");
  return `${normalized.command}|payload:${await sha256Hex(canonicalJson(payload))}`;
}

// previewのうち、利用者にとって意味のある内容(対象・差分・次回への影響)の指紋。
// revisionを表す値は除く。実施日時を省略してprepare時刻を使った完了は、時刻では
// なく実施日だけを比べる(作り直すたびに「今」が進むため)。
export async function meaningfulDigestOf(normalized: NormalizedCommand, preview: CommandPreview): Promise<string> {
  const preparedAt = normalized.payload.occurred_source === "prepared_at";
  const meaningful = withoutKeys(preview, (key) => key === "notification_reference" || key.endsWith("revision") || (preparedAt && key === "occurred_at"));
  return sha256Hex(canonicalJson(meaningful));
}

export type ConfirmationPlan = Omit<OperationConfirmation, "confirmationDecidedAt" | "meaningfulDigest" | "subjectKey">;

function isOpenChain(operation: IntegrationOperation): boolean {
  if (operation.status === "rejected" && operation.reasonCode === "stale_preview") return true;
  return operation.confirmationState === "required" && operation.status !== "succeeded";
}

// 同じ対象の最新の記録が、古いpreviewで拒否された操作か、確認待ちのまま成功して
// いない操作なら、作り直しとして基準の内容と比べる。新しい操作IDや別の接続でも
// 同じ記録を引くため、確認を回避できない。
export async function decideConfirmation(
  db: D1Database,
  input: { digest: string; householdId: string; id: string; now: Date; subjectKey: string; userId: string },
): Promise<ConfirmationPlan> {
  const head = await findSubjectChainHead(db, {
    householdId: input.householdId,
    since: new Date(input.now.getTime() - CONFIRMATION_CHAIN_WINDOW_MS).toISOString(),
    subjectKey: input.subjectKey,
    userId: input.userId,
  });
  const fresh: ConfirmationPlan = {
    baselineOperationId: input.id,
    confirmationReasonCodes: [],
    confirmationState: "not_needed",
    confirmationStatus: null,
    supersedesOperationId: null,
  };
  if (head === null || !isOpenChain(head.operation)) return fresh;
  // revisionだけが変わった(無関係な家庭の更新)なら確認しない。この記録が新しい基準になる。
  if (head.baselineDigest === input.digest) return { ...fresh, supersedesOperationId: head.operation.id };
  return {
    baselineOperationId: head.baselineOperationId,
    confirmationReasonCodes: [CHANGED_AFTER_STALE_PREVIEW],
    confirmationState: "required",
    confirmationStatus: "pending",
    supersedesOperationId: head.operation.id,
  };
}

export function confirmationUrl(issuer: string | null, previewId: string): string {
  return `${issuer ?? ""}${CONFIRMATION_PATH_PREFIX}/${encodeURIComponent(previewId)}/confirm`;
}

// 外から見える確認の状態。期限を過ぎた未確定の確認はexpiredとする。
export function visibleConfirmationStatus(operation: IntegrationOperation, now: Date): string | null {
  if (operation.confirmationState !== "required") return null;
  if (operation.confirmationStatus === "pending" && operation.expiresAt <= now.toISOString()) return "expired";
  return operation.confirmationStatus;
}

export function confirmationOutput(operation: IntegrationOperation, now: Date, issuer: string | null): Record<string, unknown> {
  if (operation.confirmationState !== "required") return { reason_codes: [], state: "not_needed" };
  return {
    confirmation_url: confirmationUrl(issuer, operation.previewId),
    expires_at: operation.expiresAt,
    reason_codes: operation.confirmationReasonCodes,
    state: "required",
    status: visibleConfirmationStatus(operation, now),
  };
}

const encoder = new TextEncoder();
const TOKEN_CONTEXT = "yamoru:integration-confirmation-token:v1";

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

// 復号できない値は、誤ったtokenとして扱う(一時的な失敗にしない)。
function fromBase64url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(value)) return null;
  let binary: string;
  try {
    binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// 承認された一つの受付記録にだけ束縛した値。保存せず、サーバーの秘密鍵から
// 都度計算する。内容が変わって作り直した操作は別の記録なので、古いtokenは効かない。
function tokenMaterial(operation: IntegrationOperation): string {
  return [
    TOKEN_CONTEXT, operation.id, operation.previewId, operation.fingerprint, operation.connectionId,
    operation.userId, operation.householdId, operation.expiresAt, operation.confirmationDecidedAt ?? "",
  ].join("\n");
}

export function createConfirmationTokens(secret: string | undefined) {
  const key = secret === undefined || encoder.encode(secret).length < 32
    ? null
    : crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return {
    async issue(operation: IntegrationOperation): Promise<string | null> {
      if (key === null || operation.confirmationStatus !== "approved") return null;
      const mac = await crypto.subtle.sign("HMAC", await key, encoder.encode(tokenMaterial(operation)));
      return base64url(new Uint8Array(mac));
    },
    async verify(operation: IntegrationOperation, token: string | undefined): Promise<boolean> {
      if (key === null || token === undefined || operation.confirmationStatus !== "approved") return false;
      const signature = fromBase64url(token);
      if (signature === null) return false;
      return crypto.subtle.verify("HMAC", await key, signature, encoder.encode(tokenMaterial(operation)));
    },
  };
}
