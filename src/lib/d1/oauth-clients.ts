// CIMD(Client ID Metadata Document)から取得したOAuthクライアント情報の写し
// (#436、YDR-052)。家庭データではなく、YAMORU全体で共有する。
// 取得と検証はsrc/features/integration/oauth/client-metadata.tsが行い、
// ここは保存と読み出しだけを持つ。

export type StoredOAuthClient = {
  clientName: string;
  clientUri: string | null;
  id: string;
  metadataFetchedAt: string;
  redirectUris: string[];
};

type OAuthClientRow = {
  client_name: string;
  client_uri: string | null;
  id: string;
  metadata_fetched_at: string;
  redirect_uris: string;
};

function parseRedirectUris(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === "string");
}

export async function getOAuthClient(
  db: D1Database,
  clientId: string,
): Promise<StoredOAuthClient | null> {
  const row = await db.prepare(
    `SELECT id, client_name, client_uri, redirect_uris, metadata_fetched_at
       FROM oauth_clients
      WHERE id = ?1`,
  ).bind(clientId).first<OAuthClientRow>();
  if (row === null) return null;
  return {
    clientName: row.client_name,
    clientUri: row.client_uri,
    id: row.id,
    metadataFetchedAt: row.metadata_fetched_at,
    redirectUris: parseRedirectUris(row.redirect_uris),
  };
}

export async function upsertOAuthClient(
  db: D1Database,
  client: StoredOAuthClient,
): Promise<void> {
  await db.prepare(
    `INSERT INTO oauth_clients (id, client_name, client_uri, redirect_uris, metadata_fetched_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (id) DO UPDATE SET
       client_name = excluded.client_name,
       client_uri = excluded.client_uri,
       redirect_uris = excluded.redirect_uris,
       metadata_fetched_at = excluded.metadata_fetched_at`,
  ).bind(
    client.id,
    client.clientName,
    client.clientUri,
    JSON.stringify(client.redirectUris),
    client.metadataFetchedAt,
  ).run();
}
