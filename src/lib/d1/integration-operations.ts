import type { BusinessEvidence } from "./todos/command-plans";

// 外部command(#437)の受付記録(integration_operations)。previewを作った時点で
// 行を作り、commitの成功は業務更新と同じbatchの最後の文で記録する。
// 設計はdocs/product/conversation-integration.md 5節とYDR-054。

export type IntegrationOperationStatus = "expired" | "prepared" | "rejected" | "succeeded";

export type IntegrationOperation = {
  businessKey: string;
  clientId: string;
  command: string;
  connectionId: string;
  createdAt: string;
  expiresAt: string;
  fingerprint: string;
  householdId: string;
  id: string;
  normalizedCommand: string;
  operationId: string;
  preview: string;
  previewId: string;
  reasonCode: string | null;
  // 拒否時に返した詳細(JSON)。再送にも同じ内容を返す。
  reasonDetail: string | null;
  requestHash: string;
  resolvedAt: string | null;
  result: string | null;
  revisionEpoch: string;
  revisionVersion: number;
  status: IntegrationOperationStatus;
  userId: string;
};

type OperationRow = {
  business_key: string;
  client_id: string;
  command: string;
  connection_id: string;
  created_at: string;
  expires_at: string;
  fingerprint: string;
  household_id: string;
  id: string;
  normalized_command: string;
  operation_id: string;
  preview: string;
  preview_id: string;
  reason_code: string | null;
  reason_detail: string | null;
  request_hash: string;
  resolved_at: string | null;
  result: string | null;
  revision_epoch: string;
  revision_version: number;
  status: IntegrationOperationStatus;
  user_id: string;
};

function fromRow(row: OperationRow): IntegrationOperation {
  return {
    businessKey: row.business_key,
    clientId: row.client_id,
    command: row.command,
    connectionId: row.connection_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    fingerprint: row.fingerprint,
    householdId: row.household_id,
    id: row.id,
    normalizedCommand: row.normalized_command,
    operationId: row.operation_id,
    preview: row.preview,
    previewId: row.preview_id,
    reasonCode: row.reason_code,
    reasonDetail: row.reason_detail,
    requestHash: row.request_hash,
    resolvedAt: row.resolved_at,
    result: row.result,
    revisionEpoch: row.revision_epoch,
    revisionVersion: row.revision_version,
    status: row.status,
    userId: row.user_id,
  };
}

// 業務の記録(activity_logs・completion_corrections)を書いた外部commandの
// 受付記録を、その記録のidempotency_keyで引く条件。訂正は項目ごとに
// `<business_key>:occurred_at`・`:performer`のキーを使う。
function operationOf(alias: string): string {
  return `io.household_id = ${alias}.household_id
      AND ${alias}.idempotency_key LIKE 'integration:%'
      AND (io.business_key = ${alias}.idempotency_key
        OR ${alias}.idempotency_key IN (io.business_key || ':occurred_at', io.business_key || ':performer'))`;
}

// 外部commandの接続元(client_id)を引くSQL式。Webからの記録はNULL。
export function operationClientExpression(alias: string): string {
  return `(SELECT io.client_id FROM integration_operations io WHERE ${operationOf(alias)})`;
}

// 外部commandで指定された実施日時の精度(day / instant)を引くSQL式。
// Webからの記録はNULL(精度は記録していない)。
export function operationDatePrecisionExpression(
  alias: string,
  path: "$.payload.changes.date_precision" | "$.payload.date_precision",
): string {
  return `(SELECT json_extract(io.normalized_command, '${path}') FROM integration_operations io WHERE ${operationOf(alias)})`;
}

// 接続ごとの操作IDで引く。接続は本人・家庭・clientを含むため、別の利用者や
// 別の接続(再接続後を含む)の操作は見えない。
export async function findIntegrationOperation(
  db: D1Database,
  connectionId: string,
  operationId: string,
): Promise<IntegrationOperation | null> {
  const row = await db.prepare(
    "SELECT * FROM integration_operations WHERE connection_id = ?1 AND operation_id = ?2",
  ).bind(connectionId, operationId).first<OperationRow>();
  return row === null ? null : fromRow(row);
}

export type PreparedOperationInput = Omit<
  IntegrationOperation,
  "reasonCode" | "reasonDetail" | "resolvedAt" | "result" | "status"
>;

// previewを保存する。同じ接続・操作IDの行がすでにあれば(同時のprepare)何も
// せずfalseを返し、呼び出し側は保存済みの行と照合する。接続が失効していれば
// 保存しない。previewを読み取ったときの家庭の世代が保存の時点でも変わって
// いないことを同じ文で確かめ、古い世代の受付記録を残さない。
export async function insertPreparedOperation(
  db: D1Database,
  input: PreparedOperationInput,
): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO integration_operations (
      id, household_id, user_id, client_id, connection_id, operation_id, command,
      request_hash, fingerprint, preview_id, normalized_command, preview, status,
      business_key, created_at, expires_at, revision_epoch, revision_version
    ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'prepared', ?13, ?14, ?15, ?16, ?17
      WHERE EXISTS (
        SELECT 1 FROM oauth_connections c
         WHERE c.id = ?5 AND c.household_id = ?2 AND c.user_id = ?3 AND c.client_id = ?4
           AND c.revoked_at IS NULL
      )
        AND EXISTS (
          SELECT 1 FROM household_read_versions v
           WHERE v.household_id = ?2 AND v.epoch = ?16 AND v.version = ?17
        )
      ON CONFLICT (connection_id, operation_id) DO NOTHING`,
  ).bind(
    input.id,
    input.householdId,
    input.userId,
    input.clientId,
    input.connectionId,
    input.operationId,
    input.command,
    input.requestHash,
    input.fingerprint,
    input.previewId,
    input.normalizedCommand,
    input.preview,
    input.businessKey,
    input.createdAt,
    input.expiresAt,
    input.revisionEpoch,
    input.revisionVersion,
  ).run();
  return result.meta.changes > 0;
}

// 未実行の操作を、期限切れまたは拒否として確定させる。すでに確定していれば
// 何もしない(同時のcommitが先に成功した場合など)。
export async function resolveOperationWithoutCommit(
  db: D1Database,
  id: string,
  status: "expired" | "rejected",
  reason: { code: string; detail: string | null },
  at: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE integration_operations SET status = ?2, reason_code = ?3, reason_detail = ?4, resolved_at = ?5
      WHERE id = ?1 AND status = 'prepared'`,
  ).bind(id, status, reason.code, reason.detail, at).run();
  return result.meta.changes > 0;
}

// 接続が今も書き込みに使えるか。失効・家庭からの離脱・パスワード変更・
// household.writeの除外のいずれでもfalseになる。
const ACTIVE_WRITE_CONNECTION = `EXISTS (
  SELECT 1 FROM oauth_connections c
    JOIN users u ON u.id = c.user_id
    JOIN household_members m ON m.household_id = c.household_id AND m.user_id = c.user_id
   WHERE c.id = integration_operations.connection_id
     AND c.household_id = integration_operations.household_id
     AND c.revoked_at IS NULL
     AND c.expires_at > ?2
     AND u.session_version = c.user_session_version
     AND (' ' || c.scopes || ' ') LIKE '% household.read %'
     AND instr(' ' || c.scopes || ' ', CASE WHEN integration_operations.command LIKE 'notification.%'
       THEN ' notifications.manage ' ELSE ' household.write ' END)>0
)`;

export async function isWriteConnectionActive(db: D1Database, operationRowId: string, at: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT ${ACTIVE_WRITE_CONNECTION} AS active FROM integration_operations WHERE id = ?1`,
  ).bind(operationRowId, at).first<{ active: number }>();
  return row?.active === 1;
}

// commitのbatchの最初に置く文。previewを作ったときから家庭の世代が変わって
// いなければ何も変えず、変わっていればstatusをNULLに評価してbatch全体を取り消す。
// 業務の更新自体が世代を進めるため、条件は業務の文より前で確かめる。
export function revisionGuardStatement(db: D1Database, id: string): D1PreparedStatement {
  return db.prepare(
    `UPDATE integration_operations
        SET status = CASE
              WHEN EXISTS (
                SELECT 1 FROM household_read_versions v
                 WHERE v.household_id = integration_operations.household_id
                   AND v.epoch = integration_operations.revision_epoch
                   AND v.version = integration_operations.revision_version
              ) THEN status
            END
      WHERE id = ?1`,
  ).bind(id);
}

const COLUMN_NAME = /^[a-z_]+$/u;

// 証跡ごとのSQL条件と、条件が使う値。値の番号はstartから順に振る。
function evidenceCondition(evidence: BusinessEvidence, start: number): { sql: string; values: unknown[] } {
  const placeholder = `?${String(start)}`;
  if ("activeCompletionLogId" in evidence) {
    return {
      sql: `EXISTS (SELECT 1 FROM activity_logs t
      WHERE t.id = ${placeholder} AND t.household_id = integration_operations.household_id
        AND t.action = 'completed'
        AND NOT EXISTS (SELECT 1 FROM activity_logs n
          WHERE n.household_id = t.household_id AND n.task_occurrence_id = t.task_occurrence_id
            AND n.action = 'completed' AND n.id <> t.id
            AND (n.recorded_at > t.recorded_at OR (n.recorded_at = t.recorded_at AND n.id > t.id))))`,
      values: [evidence.activeCompletionLogId],
    };
  }
  // tableと列名はコード内の定数だけを取り、利用者の入力を埋め込まない。
  if ("values" in evidence) {
    const entries = Object.entries(evidence.values);
    if (entries.some(([column]) => !COLUMN_NAME.test(column))) throw new Error("invalid evidence column");
    const matches = entries.map(([column], index) => ` AND b.${column} IS ?${String(start + 1 + index)}`).join("");
    return {
      sql: `EXISTS (SELECT 1 FROM ${evidence.table} b
    WHERE b.household_id = integration_operations.household_id AND b.id = ${placeholder}${matches})`,
      values: [evidence.rowId, ...entries.map(([, value]) => value)],
    };
  }
  if ("rowId" in evidence) {
    return {
      sql: `EXISTS (SELECT 1 FROM ${evidence.table} b
    WHERE b.household_id = integration_operations.household_id AND b.id = ${placeholder})`,
      values: [evidence.rowId],
    };
  }
  return {
    sql: `EXISTS (SELECT 1 FROM ${evidence.table} b
    WHERE b.household_id = integration_operations.household_id AND b.idempotency_key = ${placeholder})`,
    values: [evidence.idempotencyKey],
  };
}

function evidenceConditions(evidence: BusinessEvidence[], start: number): { sql: string[]; values: unknown[] } {
  const sql: string[] = [];
  const values: unknown[] = [];
  for (const item of evidence) {
    const condition = evidenceCondition(item, start + values.length);
    sql.push(condition.sql);
    values.push(...condition.values);
  }
  return { sql, values };
}

// commitのbatchの最後に置く文。次のすべてを満たすときだけstatusを
// 'succeeded'へ進め、満たさなければstatusをNULLに評価してNOT NULL制約で
// batch全体(業務の更新を含む)を取り消す。
// 1. 操作がまだpreparedであること(同じ操作の二重実行を防ぐ)
// 2. previewの期限内であること
// 3. 接続が書き込みに使えること(batchの直前に解除された場合を含む)
// 4. 業務の記録(evidence)がすべて存在し、対象の完了記録が今も最新であること
//
// 結果には読み取りToolと同じ形式のrevisionを加える。通知設定は整数、
// 候補は[1,id,candidateRevision]、通常の家庭データは[1,kind,id,epoch,version]。
// 複数の対象を作る操作は、それぞれの結果の位置(path)にも同じ形で加える。
// 書き込み後の世代はbatchの中でしか分からないため、この文で読み取って保存する。
export type RevisionPlacement = { id: string; kind: string; path: string };

const REVISION_PATH = /^\$(?:\.[a-z_]+)+$/u;

function revisionValue(kindParameter: number): string {
  const kind = `?${String(kindParameter)}`;
  const id = `?${String(kindParameter + 1)}`;
  return `CASE ${kind}
              WHEN 'notification_settings' THEN (
                SELECT revision FROM notification_settings
                 WHERE household_id = integration_operations.household_id
                   AND user_id = integration_operations.user_id AND user_id = ${id}
              )
              WHEN 'attention_candidate' THEN (
                SELECT '[1,' || json_quote(id) || ',' || revision || ']' FROM attention_candidates
                 WHERE household_id = integration_operations.household_id AND id = ${id}
              )
              ELSE (
                SELECT '[1,' || json_quote(${kind}) || ',' || json_quote(${id}) || ',' || json_quote(v.epoch) || ',' || v.version || ']'
                  FROM household_read_versions v
                 WHERE v.household_id = integration_operations.household_id
              ) END`;
}

export function commitReceiptStatement(
  db: D1Database,
  input: {
    at: string;
    evidence: BusinessEvidence[];
    id: string;
    result: string;
    revisionEntity: { id: string; kind: string };
    revisionPlacements?: RevisionPlacement[];
  },
): D1PreparedStatement {
  if (input.evidence.length === 0) throw new Error("commit requires business evidence");
  const placements = [{ ...input.revisionEntity, path: "$.revision" }, ...(input.revisionPlacements ?? [])];
  if (placements.some(({ path }) => !REVISION_PATH.test(path))) throw new Error("invalid revision path");
  // ?4から、placementごとに(path, kind, id)の3つを使う。
  const assignments = placements.map((_, index) => `?${String(4 + index * 3)}, ${revisionValue(5 + index * 3)}`);
  const conditions = evidenceConditions(input.evidence, 4 + placements.length * 3);
  return db.prepare(
    `UPDATE integration_operations
        SET status = CASE
              WHEN status = 'prepared' AND expires_at > ?2
                AND ${ACTIVE_WRITE_CONNECTION}
                AND ${conditions.sql.join("\n                AND ")}
              THEN 'succeeded'
            END,
            result = json_set(?3, ${assignments.join(", ")}),
            resolved_at = ?2
      WHERE id = ?1`,
  ).bind(
    input.id,
    input.at,
    input.result,
    ...placements.flatMap(({ id, kind, path }) => [path, kind, id]),
    ...conditions.values,
  );
}

// commitReceiptStatementが条件を満たさずにbatchを取り消したときのD1のエラーか。
// 取消後の処理は確定した状態を読み直して理由を決めるため、この判定には依存しない。
// 取消の仕組み自体をテストで確かめるために使う。
export function isCommitReceiptRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("NOT NULL constraint failed: integration_operations.status");
}
