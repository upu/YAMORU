import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireUser } from "../../../lib/auth/current-user";
import { getD1Context } from "../../../lib/d1/context";
import { getCurrentHouseholdId } from "../../../lib/d1/authorization";
import { getCandidateControl, getNotificationSettings, notificationOwner, usableNotificationConnection } from "../../../lib/d1/notification-settings";
import { listConnectionsForUser } from "../../../lib/d1/oauth-connection-list";
import { listDeliveries } from "../../../lib/d1/notification-deliveries";
import { createAttentionReader } from "../../../features/integration/attention/service";
import { nextNotificationTime } from "../../../features/integration/notifications/schedule";
import { NotificationSettingsForm } from "./settings-form";
import { CandidateControls } from "./candidate-controls";
import { DeliveryHistoryList } from "./delivery-history";
import styles from "./notifications.module.css";

type Query = { candidates?: string; before?: string };
async function load(query: Query) {
  const { db, session } = await getD1Context(await requireUser());
  if (!await getCurrentHouseholdId(db, session)) return null;
  const owner = await notificationOwner(db, session);
  const now = new Date();
  const saved = await getNotificationSettings(db, session);
  const available = await listConnectionsForUser(db, session, now.toISOString());
  const connections = [];
  for (const c of available) {
    if (c.status === "active" && await usableNotificationConnection(db, owner, c.id, now)) connections.push({ id: c.id, name: c.clientName });
  }
  const { env } = await getCloudflareContext({ async: true });
  const reader = createAttentionReader({ db, now: () => now, cursorSecret: process.env.AUTH_SECRET ?? env.AUTH_SECRET,
    authorize: async () => ({ ...await notificationOwner(db, session), clientId: "web", connectionId: "web", scopes: ["household.read"] }) });
  const candidates = await reader.attentionGet({ cursor: query.candidates, limit: 20 });
  const rows = await Promise.all(candidates.candidates.map(async (c) => ({ ...c, control: await getCandidateControl(db, owner, c.candidate_id) })));
  const history = await listDeliveries(db, session, { before: query.before ? Number(query.before) : undefined }, now);
  return { saved, connections, candidates, rows, history, nextAt: nextNotificationTime(saved.settings, now, now) };
}
export default async function NotificationSettingsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  let data: Awaited<ReturnType<typeof load>>;
  try { data = await load(query); }
  catch (error) {
    // 認証redirectを握りつぶさず、期限付きcursorのエラーだけ再表示へ案内する。
    if (!(error instanceof Error) || !("code" in error) || !["invalid_cursor", "cursor_expired", "read_conflict", "invalid_input"].includes(String(error.code))) throw error;
    return <main className="page-form"><h1>あなたの通知設定</h1><p>表示内容を更新してください。</p><Link href="/settings/notifications">最初から表示する</Link></main>;
  }
  if (!data) return <main className="page-form"><h1>あなたの通知設定</h1><p>家庭に参加すると通知を設定できます。</p><Link href="/household">家庭の設定へ</Link></main>;
  const { saved, connections, candidates, rows, history, nextAt } = data;
  return <main className="page-form account-page">
    <nav className="back-nav" aria-label="ページ移動"><Link href="/settings/integrations">← 外部サービスとの連携へ</Link></nav>
    <header className="detail-hero"><h1>あなたの通知設定</h1><p>この設定はあなたへの通知だけに使います。家族の通知や、共有する予定・期限は変わりません。</p></header>
    <section className="detail-card"><p>通知の配信は準備中です。設定を保存しても、まだ通知は届きません。</p>
      <NotificationSettingsForm {...saved} connections={connections} nextAt={nextAt} />
    </section>
    <section className="detail-card" aria-labelledby="candidate-title"><h2 id="candidate-title">用事ごとの通知休止</h2>
      <p>「明日のまとめ時刻まで休む」は通知だけを延期します。予定日を動かす場合は、用事の詳細を開いてください。</p>
      {!candidates.refresh_complete ? <p>通知の対象を確認しています。続きの確認へ進んでください。</p> : null}
      {candidates.refresh_complete && !rows.length ? <p>このページに通知の対象となる用事はありません。</p> : null}
      <ul className={styles.entries}>{rows.map((c) => <li key={c.candidate_id}><h3><Link href={c.detail_url}>{c.name}</Link></h3>
        <CandidateControls candidateId={c.candidate_id} control={{ ...c.control, snoozedUntil: c.control.snoozedUntil && c.control.snoozedUntil > new Date().toISOString() ? c.control.snoozedUntil : null }} timeZone={saved.settings.timeZone} />
      </li>)}</ul>
      {candidates.next_cursor ? <Link href={`/settings/notifications?candidates=${encodeURIComponent(candidates.next_cursor)}`}>続きの確認へ</Link> : null}
    </section>
    <section className="detail-card" aria-labelledby="delivery-title"><h2 id="delivery-title">配信履歴（90日分）</h2>
      <DeliveryHistoryList items={history.items} timeZone={saved.settings.timeZone} />
      {history.nextBefore ? <Link href={`/settings/notifications?before=${String(history.nextBefore)}`}>以前の配信履歴</Link> : null}
    </section>
  </main>;
}
