"use server";
import { revalidatePath } from "next/cache";
import { getD1Context } from "../../../lib/d1/context";
import { getNotificationSettings, saveNotificationSettings, setCandidateControl } from "../../../lib/d1/notification-settings";
import { NotificationError } from "../../../features/integration/notifications/contract";
import { tomorrowNotificationTime } from "../../../features/integration/notifications/schedule";
import type { NotificationFormState } from "./state";

function failure(error: unknown): NotificationFormState {
  const messages = {
    invalid_input: "時刻と入力内容を確認してください。再通知の間隔は24〜720時間です。",
    not_found: "対象が見つかりません。画面を更新してください。",
    stale_settings: "設定が別の画面で変更されました。画面を更新して確認してください。",
    connection_unavailable: "通知を受け取れる連携先を選んでください。解除済みの場合は再連携が必要です。",
    insufficient_scope: "通知の操作に必要な許可がありません。",
  };
  return { status: "error", message: error instanceof NotificationError ? messages[error.code] : "保存できませんでした。時間をおいて再度お試しください。" };
}
function repeat(form: FormData, name: string) {
  const value = form.get(name);
  return value === "" ? null : Number(value);
}
export async function saveNotificationAction(_state: NotificationFormState, form: FormData): Promise<NotificationFormState> {
  try {
    const { db, session } = await getD1Context();
    await saveNotificationSettings(db, session, {
      enabled: form.get("enabled") === "on", connectionId: form.get("connectionId") || null,
      muted: form.get("muted") === "on", timeZone: form.get("timeZone"), mode: form.get("mode"), digestTime: form.get("digestTime"),
      quietEnabled: form.get("quietEnabled") === "on", quietStart: form.get("quietStart"), quietEnd: form.get("quietEnd"),
      repeatHighHours: repeat(form, "repeatHighHours"), repeatNormalHours: repeat(form, "repeatNormalHours"),
    }, Number(form.get("revision")), new Date());
  } catch (error) { return failure(error); }
  revalidatePath("/settings/notifications");
  return { status: "success", message: "あなたの通知設定を保存しました。" };
}
export async function candidateControlAction(_state: NotificationFormState, form: FormData): Promise<NotificationFormState> {
  try {
    const { db, session } = await getD1Context();
    const candidateId = form.get("candidateId");
    const action = form.get("control");
    if (typeof candidateId !== "string" || typeof action !== "string" || !["tomorrow", "mute", "resume"].includes(action)) throw new NotificationError("invalid_input");
    const now = new Date();
    const { settings } = await getNotificationSettings(db, session);
    const snoozedUntil = action === "tomorrow" ? tomorrowNotificationTime(settings, now) : null;
    await setCandidateControl(db, session, candidateId, { muted: action === "mute", snoozedUntil }, now);
  } catch (error) { return failure(error); }
  revalidatePath("/settings/notifications");
  return { status: "success", message: "この用事の通知設定を変更しました。予定や期限は変わりません。" };
}
