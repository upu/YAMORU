import Link from "next/link";
import type { NotificationSettings } from "../../../features/integration/notifications/contract";

export function NotificationDeliveryStatus({ settings, connectionAvailable }: { settings: NotificationSettings; connectionAvailable: boolean }) {
  const [state, next] = !settings.enabled
    ? ["お知らせの受け取り設定はOFFです。", "受け取る場合は、準備ガイドを確認して下の条件を設定してください。"]
    : !connectionAvailable
      ? ["受け取り先の連携・許可を確認してください。", "連携先から接続し直して、下の条件で受け取り先を選んでください。"]
      : settings.muted
        ? ["あなたへのお知らせを休止中です。", "再開する場合は、下の条件で「自分への通知をすべて休止する」を解除して保存してください。"]
        : ["お知らせの受け取り設定はONです。", "定期タスクの稼働は連携先で確認してください。"];
  return <section className="detail-card" aria-labelledby="notification-status-title">
    <h2 id="notification-status-title">お知らせの状態</h2>
    <p>{state}</p>
    <p>{next}</p>
    <p>設定を保存するだけでは定期タスクは作成されません。外部の定期タスクの稼働状態はYAMORUから確認できません。</p>
    <p><Link href="/settings/integrations/guide#periodic-title">定期的なお知らせの準備</Link>・<Link href="/settings/integrations/guide#recovery-title">通知が来ないとき</Link></p>
  </section>;
}
