-- #437: 外部クライアントからの変更操作(command_prepare / command_commit)の
-- 受付記録(receipt)。設計の正本はdocs/product/conversation-integration.mdの
-- 5節とYDR-049、実装方式はYDR-054。
--
-- 追加だけのexpand migrationであり、既存テーブルを変更しない。旧Workerは
-- このテーブルを参照しないため、適用後も旧Workerのまま動き続ける。
--
-- 0032(家庭の世代)の後に適用する。
--
-- 1行が、利用者の意図した一つの操作(クライアントが生成したoperation_id)を
-- 表す。previewを作った時点で行を作り(status = 'prepared')、commitの成功は
-- 業務データの更新と同じD1 batchの最後の文でstatus = 'succeeded'へ進める。
-- その文はstatusを条件に応じてNULLへ評価させ、NOT NULL制約の違反でbatch全体を
-- 取り消す。業務の記録が書けなかった、previewの期限を過ぎた、接続が失効した、
-- のいずれでも、業務データと受付記録の片方だけが残ることはない。
CREATE TABLE integration_operations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id),
  connection_id TEXT NOT NULL REFERENCES oauth_connections(id) ON DELETE CASCADE,
  -- クライアントが一つの操作につき一度だけ生成するUUID。通信の再試行でも
  -- 同じ値を送る。一意性は接続ごとに保証する(接続は本人・家庭・clientを含む)。
  operation_id TEXT NOT NULL,
  -- commandの種類はアプリ側で検証する。後続のcommandを追加するたびに
  -- CHECK制約を作り直さなくて済むよう、ここでは列挙しない。
  command TEXT NOT NULL,
  -- 最初のprepare要求(command・対象・payload)の正規化JSONのSHA-256。
  -- 同じoperation_idの再prepareが同じ内容かを照合する。
  request_hash TEXT NOT NULL,
  -- 確定した操作内容(command・対象・正規化payload・参照revision)のSHA-256。
  fingerprint TEXT NOT NULL,
  preview_id TEXT NOT NULL UNIQUE,
  -- 「今」や「昨日」をprepare時に絶対値へ固定した正規化command(JSON)。
  normalized_command TEXT NOT NULL,
  -- previewを作ったときの家庭の世代(0032のhousehold_read_versions、YDR-053)。
  -- commitのbatchは最初の文でこの世代が変わっていないことを確かめ、変わって
  -- いればbatch全体を取り消す。家族による無関係な更新でも再確認になる保守的な方式。
  revision_epoch TEXT NOT NULL,
  revision_version INTEGER NOT NULL,
  -- 利用者へ示した差分と次回への影響(JSON)。commit時に同じ内容を
  -- 計算し直し、変わっていればstale_previewとして実行しない。
  preview TEXT NOT NULL,
  status TEXT NOT NULL,
  -- rejected / expiredの理由コード(conversation-integration.md 5節)。
  reason_code TEXT,
  -- 拒否したときに返した詳細(field_errors・current_state、JSON)。同じ操作IDの
  -- 再送やoperation_getにも、最初の応答と同じ内容を返すために保存する。
  reason_detail TEXT,
  -- 業務側の記録(activity_logs・completion_corrections)へ渡した
  -- idempotency_keyの元。受付記録と業務の履歴をこの値で結び付ける。
  business_key TEXT NOT NULL UNIQUE,
  -- 成功時の結果(JSON)。再送には保存したこの値を返し、再実行しない。
  result TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (connection_id, operation_id),
  CHECK (status IN ('prepared', 'succeeded', 'rejected', 'expired')),
  CHECK (length(operation_id) = 36),
  CHECK (length(command) BETWEEN 1 AND 64),
  CHECK (json_valid(normalized_command) AND json_valid(preview)),
  CHECK (result IS NULL OR json_valid(result)),
  CHECK (reason_detail IS NULL OR (reason_code IS NOT NULL AND json_valid(reason_detail))),
  CHECK ((status = 'prepared') = (resolved_at IS NULL)),
  CHECK ((status IN ('rejected', 'expired')) = (reason_code IS NOT NULL)),
  CHECK (status <> 'succeeded' OR result IS NOT NULL),
  CHECK (expires_at > created_at)
);

CREATE INDEX integration_operations_household_created_idx
  ON integration_operations(household_id, created_at DESC);
