import type { ConnectionStatus, ConnectionSummary } from "../../../lib/d1/oauth-connection-list";
import type { ConnectionRevokedReason } from "../../../lib/d1/oauth-connections";
import { parseStoredScopes, SCOPE_DESCRIPTIONS } from "../../../features/integration/scopes";
import { formatTokyoDate } from "../../time-zone";
import styles from "./integrations.module.css";
import { RevokeConnectionButton } from "./revoke-connection-button";

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  active: "連携中",
  expired: "期限切れ",
  revoked: "解除済み",
};

const STATUS_CLASSES: Record<ConnectionStatus, string> = {
  active: styles.statusActive,
  expired: styles.statusExpired,
  revoked: styles.statusRevoked,
};

const REVOKED_REASON_LABELS: Record<ConnectionRevokedReason, string> = {
  client_revoked: "接続元のアプリから解除されました。",
  credentials_changed: "パスワードが変更されたため、安全のため自動で解除しました。",
  membership_changed: "連携した家庭から離れたため、自動で解除しました。",
  token_reuse_detected: "使用済みの認証情報が再び使われたため、安全のため自動で解除しました。",
  user_revoked: "あなたが解除しました。",
};

function StatusNote({ connection }: { connection: ConnectionSummary }) {
  if (connection.status === "revoked" && connection.revokedReason !== null) {
    // 前提が崩れただけで解除の記録がまだ無い接続は、日付を出さず理由だけを示す。
    const when = connection.revokedAt === null ? "" : `${formatTokyoDate(connection.revokedAt)}に解除。`;
    return (
      <p className={styles.note}>
        {when}{REVOKED_REASON_LABELS[connection.revokedReason]}
        再び使うには、接続元のアプリから改めて連携してください。
      </p>
    );
  }
  if (connection.status === "expired") {
    return <p className={styles.note}>しばらく使われなかったため期限が切れました。接続元のアプリから改めて連携してください。</p>;
  }
  return null;
}

function ConnectionItem({ connection }: { connection: ConnectionSummary }) {
  const host = new URL(connection.clientId).hostname;
  return (
    <li className={styles.row}>
      <div className={styles.rowSummary}>
        <span className={styles.clientName}>{connection.clientName}({host})</span>
        <span className={`${styles.status} ${STATUS_CLASSES[connection.status]}`}>
          {STATUS_LABELS[connection.status]}
        </span>
      </div>
      <dl className={styles.facts}>
        <dt>対象の家庭</dt>
        <dd>{connection.householdName ?? "(現在は所属していない家庭)"}</dd>
        <dt>連携した日</dt>
        <dd>{formatTokyoDate(connection.createdAt)}</dd>
        <dt>最後に使われた日</dt>
        <dd>{connection.lastUsedAt === null ? "まだ使われていません" : formatTokyoDate(connection.lastUsedAt)}</dd>
      </dl>
      <ul aria-label="許可している範囲" className={styles.scopes}>
        {parseStoredScopes(connection.scopes).map((scope) => (
          <li key={scope}>{SCOPE_DESCRIPTIONS[scope].label}</li>
        ))}
      </ul>
      <StatusNote connection={connection} />
      {connection.status === "revoked" ? null : (
        <RevokeConnectionButton clientName={connection.clientName} connectionId={connection.id} />
      )}
    </li>
  );
}

export function ConnectionList({ connections }: { connections: readonly ConnectionSummary[] }) {
  if (connections.length === 0) {
    return <p>連携している外部サービスはありません。</p>;
  }
  return (
    <ul className={styles.list}>
      {connections.map((connection) => (
        <ConnectionItem connection={connection} key={connection.id} />
      ))}
    </ul>
  );
}
