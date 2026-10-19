import type { DeliveryHistory } from "../../../lib/d1/notification-deliveries";
import { DELIVERY_LABELS, REASON_LABELS } from "../../../features/integration/notifications/labels";
import styles from "./notifications.module.css";
export function DeliveryHistoryList({ items, timeZone }: { items: DeliveryHistory[]; timeZone: string }) {
  return <>
    <p>「案内したと報告」は連携先からの報告です。利用者が読んだことを示すものではありません。用事の完了とも別です。</p>
    {!items.length ? <p>配信履歴はまだありません。</p> : null}
    <ul className={styles.entries}>{items.map((item) => <li key={item.sequence}>
      <h3>{item.candidateName}</h3><p>{DELIVERY_LABELS[item.outcome]}</p>
      <time dateTime={item.recordedAt}>{new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(item.recordedAt))}</time>
      {item.reason ? <p>{REASON_LABELS[item.reason] ?? "配信できませんでした。連携と通知の設定を確認してください。"}</p> : null}
      {item.outcome === "unknown" ? <p>重複するおそれがあるため自動再送していません。連携先の会話で届いているかを確認してください。</p> : null}
    </li>)}</ul>
  </>;
}
