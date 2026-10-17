"use client";
import { useActionState } from "react";
import type { NotificationSettings } from "../../../features/integration/notifications/contract";
import { saveNotificationAction } from "./actions";
import { INITIAL_NOTIFICATION_STATE } from "./state";
import styles from "./notifications.module.css";

type Props = { settings: NotificationSettings; revision: number; connections: { id: string; name: string }[]; nextAt: string };
function TimeFields({ settings: s }: { settings: NotificationSettings }) {
  const zones = [...new Set([s.timeZone, "Asia/Tokyo", "UTC", ...Intl.supportedValuesOf("timeZone")])];
  return <fieldset className={styles.fields}><legend>知らせる時間</legend>
    <label>まとめ方<select name="mode" defaultValue={s.mode}><option value="daily">一日一回まとめる</option><option value="individual">候補ごとに知らせる</option></select></label>
    <label>まとめる時刻<input name="digestTime" type="time" required defaultValue={s.digestTime} /></label>
    <label>通知のタイムゾーン<select name="timeZone" defaultValue={s.timeZone}>{zones.map((z) => <option key={z} value={z}>{z === "Asia/Tokyo" ? "日本（Asia/Tokyo）" : z}</option>)}</select></label>
    <label><input name="quietEnabled" type="checkbox" defaultChecked={s.quietEnabled} /> 静かな時間を設ける</label>
    <label>休止する時刻<input name="quietStart" type="time" required defaultValue={s.quietStart} /></label>
    <label>再開する時刻<input name="quietEnd" type="time" required defaultValue={s.quietEnd} /></label>
    <p>必達日を過ぎた用事でも、静かな時間には知らせません。予定・期限は日本時間のままです。</p>
  </fieldset>;
}
function RepeatFields({ settings: s }: { settings: NotificationSettings }) {
  return <fieldset className={styles.fields}><legend>未対応の用事をもう一度知らせる</legend>
    <p>空欄なら再通知しません。設定する場合は24〜720時間おき、同じ用事の再通知は最大3回です。</p>
    <label>優先度が高い用事の間隔（時間）<input name="repeatHighHours" type="number" min="24" max="720" step="1" defaultValue={s.repeatHighHours ?? ""} /></label>
    <label>通常の用事の間隔（時間）<input name="repeatNormalHours" type="number" min="24" max="720" step="1" defaultValue={s.repeatNormalHours ?? ""} /></label>
  </fieldset>;
}
export function NotificationSettingsForm({ settings: s, revision, connections, nextAt }: Props) {
  const [state, action, pending] = useActionState(saveNotificationAction, INITIAL_NOTIFICATION_STATE);
  return <form action={action} className={styles.fields}>
    <input type="hidden" name="revision" value={revision} />
    <label><input type="checkbox" name="enabled" defaultChecked={s.enabled} /> 通知を有効にする</label>
    <label>通知先<select name="connectionId" defaultValue={s.connectionId ?? ""}>
      <option value="">連携先を選択</option>
      {s.connectionId && !connections.some((c) => c.id === s.connectionId) ? <option value={s.connectionId}>以前の連携先（現在は利用できません）</option> : null}
      {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select></label>
    {!connections.length ? <p>通知の受け取りを許可した連携先がありません。外部サービスから連携し、通知の受け取りを許可してください。</p> : null}
    <label><input type="checkbox" name="muted" defaultChecked={s.muted} /> 自分への通知をすべて休止する</label>
    <TimeFields settings={s} /><RepeatFields settings={s} />
    <p>保存済みの時間設定で、今から発生する候補を知らせられる最初の時刻：<time dateTime={nextAt}>{new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: s.timeZone }).format(new Date(nextAt))}（{s.timeZone}）</time></p>
    <p>これは配信可能な時刻の目安です。通知の有効・休止設定、候補の状態、接続先によって変わります。</p>
    <button type="submit" disabled={pending}>{pending ? "保存中…" : "通知設定を保存"}</button>
    {state.message ? <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
  </form>;
}
