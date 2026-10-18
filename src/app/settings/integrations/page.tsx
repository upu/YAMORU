import Link from "next/link";

import { requireUser } from "../../../lib/auth/current-user";
import { getD1Context } from "../../../lib/d1/context";
import { listConnectionsForUser } from "../../../lib/d1/oauth-connection-list";
import { getOAuthRuntime } from "../../../features/integration/oauth/runtime";
import { ConnectionList } from "./connection-list";

// 外部サービスとの連携の管理(#436)。本人が許可した接続先と範囲を確かめ、
// 解除する。家族の接続は表示しない。
export default async function IntegrationsPage() {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const [connections, runtime] = await Promise.all([
    listConnectionsForUser(db, session, new Date().toISOString()),
    getOAuthRuntime(),
  ]);
  return (
    <main className="page-form account-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/account">← アカウントへ戻る</Link>
      </nav>
      <header className="detail-hero">
        <p className="detail-kicker">INTEGRATIONS</p>
        <h1>外部サービスとの連携</h1>
        <p>会話アシスタントなど、あなたが家庭のデータへのアクセスを許可した外部サービスです。</p>
      </header>
      <section className="detail-card"><h2>会話アシスタントから使う</h2><p>接続と許可、お知らせの試し方、定期的な確認と停止の手順を案内します。</p><Link href="/settings/integrations/guide">会話連携の始め方・通知が来ないとき</Link></section>
      <section className="detail-card"><h2>あなたへの通知</h2><p>通知の時間や用事ごとの休止、配信履歴を確認できます。</p><Link href="/settings/notifications">通知設定と配信履歴</Link></section>
      <section aria-labelledby="connections-title" className="detail-card">
        <h2 id="connections-title">連携中・過去の連携</h2>
        {runtime.config === null ? (
          <p>現在、このYAMORUでは新しい外部サービスとの連携を受け付けていません。</p>
        ) : null}
        <ConnectionList connections={connections} />
      </section>
      <section aria-labelledby="connections-help-title" className="detail-card">
        <h2 id="connections-help-title">解除と再連携</h2>
        <p>
          解除すると、その外部サービスはすぐに家庭のデータを読めなくなり、変更や通知の受け取りもできなくなります。解除前の記録は残ります。
        </p>
        <p>もう一度使うときは、外部サービス側から連携をやり直し、許可する範囲を改めて選びます。</p>
      </section>
    </main>
  );
}
