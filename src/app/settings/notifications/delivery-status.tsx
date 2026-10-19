import Link from "next/link";
import type { NotificationSettings } from "../../../features/integration/notifications/contract";

export function NotificationDeliveryStatus({ settings, connectionAvailable }: { settings: NotificationSettings; connectionAvailable: boolean }) {
  const state = !settings.enabled ? "お知らせの受け取り設定はOFFです。" : settings.muted ? "あなたへのお知らせを休止中です。"
    : !connectionAvailable ? "受け取り先の連携・許可を確認してください。" : "お知らせの受け取り設定はONです。定期タスクの稼働は連携先で確認してください。";
  return <section className="detail-card" aria-labelledby="notification-status-title">
    <h2 id="notification-status-title">定期的なお知らせを使うには</h2>
    <p>{state}</p>
    <p>連携先の定期タスクがYAMORUを確認して知らせます。会話での確認・操作だけなら、この設定は不要です。</p>
    <ol>
      <li>連携先で受け取りを許可し、定期タスクを準備します。</li>
      <li>下の設定で連携先・時間帯を選び、受け取りをONにして保存します。</li>
      <li>連携先で次回予定と、最初の実行でのお知らせを確認します。</li>
    </ol>
    <p>設定を保存するだけでは定期タスクは作成されません。外部の定期タスクの稼働状態はYAMORUから確認できません。</p>
    <Link href="/settings/integrations/guide#periodic-title">定期的なお知らせの準備・届かないとき</Link>
  </section>;
}
