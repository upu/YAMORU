// 外部接続の運用ログ。docs/product/conversation-integration.md 8節に従い、
// 接続ID・client_id・理由コードだけを残す。token・code・PKCEの値、家庭名や
// 家庭データ、利用者のメールアドレス、利用者が選んだscopeは型の上でも受け取らない。
// 呼び出し元が送ってきた値(grant_type等)は書かず、client_idも許可リストに
// あるものだけを書く(未認証の要求が任意の文字列をログへ残せないように)。

export type OAuthLogEvent = {
  clientId?: string;
  connectionId?: string;
  error?: string;
  event:
    | "authorization_denied"
    | "authorization_failed"
    | "authorization_granted"
    | "client_metadata_rejected"
    | "connection_revoked"
    | "token_failed"
    | "token_issued";
  reason?: string;
};

export function logOAuthEvent(entry: OAuthLogEvent): void {
  const line = JSON.stringify({ ...entry, event: `yamoru.oauth.${entry.event}` });
  if (entry.event.endsWith("_failed") || entry.event.endsWith("_rejected")) {
    console.warn(line);
    return;
  }
  console.info(line);
}
