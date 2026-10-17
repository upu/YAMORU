import { requireCurrentHouseholdId, requireD1Session, type D1Session } from "./authorization";
import {
  ACTIVE_WRITE_CONNECTION,
  fromRow,
  type IntegrationOperation,
  type OperationRow,
} from "./integration-operations";

// 外部commandの追加確認(YDR-062)。staleになった操作と作り直しの対応を
// サーバー側で追跡し、確認必須の操作の承認・拒否を本人の確認画面から記録する。

// staleな操作の連鎖を追う期間。これより古い記録は作り直しとして扱わない。
export const CONFIRMATION_CHAIN_WINDOW_MS = 24 * 60 * 60 * 1000;

export type SubjectChainHead = {
  // 利用者が最後に同意した内容の指紋。比較の基準。
  baselineDigest: string | null;
  baselineOperationId: string | null;
  operation: IntegrationOperation;
};

// 同じ本人・家庭・対象の、期間内で最新の受付記録。接続やclientは問わない
// (再接続や別のclientでも作り直しの対応を見失わない)。同じ時刻の記録は
// 保存した順(rowid)で後のものを最新とする。
export async function findSubjectChainHead(
  db: D1Database,
  input: { householdId: string; since: string; subjectKey: string; userId: string },
): Promise<SubjectChainHead | null> {
  const row = await db.prepare(
    `SELECT o.*, b.meaningful_digest AS baseline_digest
       FROM integration_operations o
       LEFT JOIN integration_operations b
         ON b.id = CASE WHEN o.confirmation_status = 'approved' THEN o.id ELSE coalesce(o.baseline_operation_id, o.id) END
        AND b.household_id = o.household_id
      WHERE o.household_id = ?1 AND o.user_id = ?2 AND o.subject_key = ?3 AND o.created_at > ?4
      ORDER BY o.created_at DESC, o.rowid DESC
      LIMIT 1`,
  ).bind(input.householdId, input.userId, input.subjectKey, input.since)
    .first<OperationRow & { baseline_digest: string | null }>();
  if (row === null) return null;
  const operation = fromRow(row);
  return {
    baselineDigest: row.baseline_digest,
    baselineOperationId: operation.confirmationStatus === "approved" ? operation.id : operation.baselineOperationId ?? operation.id,
    operation,
  };
}

// 確認画面に表示する、本人の確認必須の操作。
export type ConfirmationView = {
  baselinePreview: string | null;
  clientName: string;
  operation: IntegrationOperation;
};

async function currentUser(db: D1Database, session: D1Session) {
  const user = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  return { householdId, userId: user.userId };
}

// preview IDで引く。本人・現在の家庭の確認必須の操作だけを返し、他人の操作や
// 確認不要の操作は存在を明かさずnullにする。
export async function loadConfirmation(
  db: D1Database,
  session: D1Session,
  previewId: string,
): Promise<ConfirmationView | null> {
  const { householdId, userId } = await currentUser(db, session);
  const row = await db.prepare(
    `SELECT o.*, c.client_name AS view_client_name, b.preview AS baseline_preview
       FROM integration_operations o
       JOIN oauth_connections c ON c.id = o.connection_id
       LEFT JOIN integration_operations b
         ON b.id = o.baseline_operation_id AND b.household_id = o.household_id AND b.id <> o.id
      WHERE o.preview_id = ?1 AND o.household_id = ?2 AND o.user_id = ?3 AND o.confirmation_state = 'required'`,
  ).bind(previewId, householdId, userId)
    .first<OperationRow & { baseline_preview: string | null; view_client_name: string }>();
  if (row === null) return null;
  return { baselinePreview: row.baseline_preview, clientName: row.view_client_name, operation: fromRow(row) };
}

export type ConfirmationDecision = "approved" | "denied" | "expired" | "not_pending" | "stale";

// 承認する。本人・家庭・未実行・期限内・確認待ち・接続が書き込みに使えること・
// 家庭の世代がpreview時と同じことを、一つの条件付き更新で確かめる。世代が変わって
// いれば承認せず、古いpreviewとして確定させる(会話での作り直しへ戻す)。
export async function approveConfirmation(
  db: D1Database,
  session: D1Session,
  previewId: string,
  at: string,
): Promise<ConfirmationDecision> {
  const { householdId, userId } = await currentUser(db, session);
  const approved = await db.prepare(
    `UPDATE integration_operations
        SET confirmation_status = 'approved', confirmation_decided_at = ?2
      WHERE preview_id = ?1 AND household_id = ?3 AND user_id = ?4
        AND status = 'prepared' AND expires_at > ?2
        AND confirmation_state = 'required' AND confirmation_status = 'pending'
        AND ${ACTIVE_WRITE_CONNECTION}
        AND EXISTS (
          SELECT 1 FROM household_read_versions v
           WHERE v.household_id = integration_operations.household_id
             AND v.epoch = integration_operations.revision_epoch
             AND v.version = integration_operations.revision_version
        )`,
  ).bind(previewId, at, householdId, userId).run();
  if (approved.meta.changes > 0) return "approved";
  return settleUndecided(db, { householdId, previewId, userId }, at);
}

// 承認できなかった理由を、確定した状態から決める。期限内・確認待ちのまま
// 世代だけが変わっていれば、古いpreviewとして確定させる。
async function settleUndecided(
  db: D1Database,
  key: { householdId: string; previewId: string; userId: string },
  at: string,
): Promise<ConfirmationDecision> {
  const row = await db.prepare(
    `SELECT status, expires_at, confirmation_status FROM integration_operations
      WHERE preview_id = ?1 AND household_id = ?2 AND user_id = ?3 AND confirmation_state = 'required'`,
  ).bind(key.previewId, key.householdId, key.userId)
    .first<{ confirmation_status: string | null; expires_at: string; status: string }>();
  if (row === null || row.status !== "prepared" || row.confirmation_status !== "pending") return "not_pending";
  if (row.expires_at <= at) return "expired";
  const stale = await db.prepare(
    `UPDATE integration_operations
        SET status = 'rejected', reason_code = 'stale_preview', resolved_at = ?2
      WHERE preview_id = ?1 AND household_id = ?3 AND user_id = ?4 AND status = 'prepared'
        AND NOT EXISTS (
          SELECT 1 FROM household_read_versions v
           WHERE v.household_id = integration_operations.household_id
             AND v.epoch = integration_operations.revision_epoch
             AND v.version = integration_operations.revision_version
        )`,
  ).bind(key.previewId, at, key.householdId, key.userId).run();
  // 世代が同じなら、接続が書き込みに使えない(解除・権限の変更など)。
  return stale.meta.changes > 0 ? "stale" : "not_pending";
}

// 拒否する。確認待ちの未実行の操作を、拒否として確定させる。
export async function denyConfirmation(
  db: D1Database,
  session: D1Session,
  previewId: string,
  at: string,
): Promise<ConfirmationDecision> {
  const { householdId, userId } = await currentUser(db, session);
  const denied = await db.prepare(
    `UPDATE integration_operations
        SET confirmation_status = 'denied', confirmation_decided_at = ?2,
            status = 'rejected', reason_code = 'confirmation_denied', resolved_at = ?2
      WHERE preview_id = ?1 AND household_id = ?3 AND user_id = ?4
        AND status = 'prepared' AND confirmation_state = 'required' AND confirmation_status = 'pending'`,
  ).bind(previewId, at, householdId, userId).run();
  return denied.meta.changes > 0 ? "denied" : "not_pending";
}
