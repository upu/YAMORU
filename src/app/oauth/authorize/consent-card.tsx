import type { StoredOAuthClient } from "../../../lib/d1/oauth-clients";
import type { AuthorizationPageError, ValidAuthorizationRequest } from "../../../features/integration/oauth/authorization-request";
import { REQUIRED_SCOPE, SCOPE_DESCRIPTIONS } from "../../../features/integration/scopes";
import { decideAuthorization } from "./actions";
import { DISPLAYED_CLIENT_NAME_FIELD } from "./consent-snapshot";
import styles from "./consent.module.css";

const PAGE_ERROR_MESSAGES: Record<AuthorizationPageError | "client_unavailable", string> = {
  client_unavailable: "接続元の情報を取得できませんでした。時間をおいて、接続元のアプリからやり直してください。",
  invalid_client: "この接続元はYAMORUへの連携を許可されていません。",
  invalid_redirect_uri: "接続元から届いた戻り先が登録内容と一致しないため、連携できません。",
  invalid_request: "連携の要求が正しくありません。接続元のアプリからやり直してください。",
};

export function AuthorizationErrorCard({ error }: { error: AuthorizationPageError | "client_unavailable" }) {
  return (
    <section aria-labelledby="authorize-error-title" className="detail-card">
      <h2 id="authorize-error-title">連携を始められません</h2>
      <p role="alert">{PAGE_ERROR_MESSAGES[error]}</p>
    </section>
  );
}

export function NoHouseholdCard({ rawRequest }: { rawRequest: string }) {
  return (
    <section aria-labelledby="authorize-no-household-title" className="detail-card">
      <h2 id="authorize-no-household-title">家庭への所属が必要です</h2>
      <p>外部サービスと連携するには、先に家庭を作成するか、家族からの招待を受けてください。</p>
      <form action={decideAuthorization} className={styles.actions}>
        <input name="request" type="hidden" value={rawRequest} />
        <button className={styles.denyButton} name="decision" type="submit" value="deny">
          接続元へ戻る
        </button>
      </form>
    </section>
  );
}

function ScopeOption({ scope, requested }: { requested: boolean; scope: keyof typeof SCOPE_DESCRIPTIONS }) {
  if (!requested) return null;
  const description = SCOPE_DESCRIPTIONS[scope];
  const required = scope === REQUIRED_SCOPE;
  return (
    <li className={styles.scope}>
      <label>
        <input
          defaultChecked
          disabled={required}
          name="scope"
          type="checkbox"
          value={scope}
        />
        <span className={styles.scopeText}>
          <strong>{description.label}{required ? "(必須)" : ""}</strong>
          <span>{description.detail}</span>
        </span>
      </label>
    </li>
  );
}

type ConsentCardProps = {
  client: StoredOAuthClient;
  email: string;
  householdName: string;
  rawRequest: string;
  request: ValidAuthorizationRequest;
};

// 接続元の名前はクライアント自身が名乗る値なので、確かめられるホスト名を並べて出す。
export function ConsentCard({ client, email, householdName, rawRequest, request }: ConsentCardProps) {
  const clientHost = new URL(client.id).hostname;
  const redirectHost = new URL(request.redirectUri).hostname;
  return (
    <section aria-labelledby="consent-title" className="detail-card">
      <h2 id="consent-title">{client.clientName}にYAMORUへのアクセスを許可しますか</h2>
      <dl className={styles.facts}>
        <dt>接続元</dt>
        <dd>{client.clientName}({clientHost})</dd>
        <dt>許可後の戻り先</dt>
        <dd>{redirectHost}</dd>
        <dt>対象の家庭</dt>
        <dd>{householdName}</dd>
        <dt>あなたのアカウント</dt>
        <dd>{email}</dd>
      </dl>
      <form action={decideAuthorization}>
        <input name="request" type="hidden" value={rawRequest} />
        <input name={DISPLAYED_CLIENT_NAME_FIELD} type="hidden" value={client.clientName} />
        <fieldset className={styles.scopes}>
          <legend>許可する範囲</legend>
          <p>外したい範囲はチェックを外してください。読み取りは連携に必須です。</p>
          <ul>
            {Object.keys(SCOPE_DESCRIPTIONS).map((scope) => (
              <ScopeOption
                key={scope}
                requested={request.requestedScopes.includes(scope as keyof typeof SCOPE_DESCRIPTIONS)}
                scope={scope as keyof typeof SCOPE_DESCRIPTIONS}
              />
            ))}
          </ul>
        </fieldset>
        <p className={styles.note}>
          YAMORUのパスワードやログイン状態は接続元へ渡しません。連携はアカウントの「外部サービスとの連携」からいつでも解除できます。
        </p>
        <div className={styles.actions}>
          <button className="auth-submit" name="decision" type="submit" value="approve">
            許可する
          </button>
          <button className={styles.denyButton} name="decision" type="submit" value="deny">
            許可しない
          </button>
        </div>
      </form>
    </section>
  );
}
