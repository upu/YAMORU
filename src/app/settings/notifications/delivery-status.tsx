import Link from "next/link";
import type { NotificationSettings } from "../../../features/integration/notifications/contract";

export function NotificationDeliveryStatus({ settings, connectionAvailable }: { settings: NotificationSettings; connectionAvailable: boolean }) {
  const state = !settings.enabled ? "通知設定はOFFです。" : settings.muted ? "あなたへの通知を休止中です。"
    : !connectionAvailable ? "通知先の連携・許可を確認してください。" : "通知設定は有効です。";
  return <section className="detail-card" aria-labelledby="notification-status-title">
    <h2 id="notification-status-title">通知の仕組みと稼働確認</h2>
    <p>{state}</p>
    <p>通知には、連携先の会話アシスタントが定期的にYAMORUを確認する方法を使います。設定を保存するだけでは定期タスクは作成されません。</p>
    <p>外部の定期タスクの稼働状態はYAMORUから確認できません。連携先で有効状態・次回予定・直近の実行結果を確認してください。</p>
    <Link href="/settings/integrations/guide">会話連携の始め方・通知が来ないとき</Link>
  </section>;
}
