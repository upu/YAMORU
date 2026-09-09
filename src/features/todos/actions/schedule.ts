"use server";

import { getD1Context } from "../../../lib/d1/context";
import {
  postponeTaskOccurrence as postponeTaskOccurrenceInD1,
  setOneTimeTaskSchedule as setOneTimeTaskScheduleInD1,
} from "../../../lib/d1/todos";
import { formatTokyoDate, tokyoDateToUtcIso } from "../../../app/time-zone";
import type { MaintenanceTodoActionState } from "../state";
import {
  CONFLICT_MESSAGE_FRAGMENT,
  errorMessage,
  mapRpcError,
  STATE_CHANGED_ERROR,
} from "./rpc-error";
import { revalidateTodoViews } from "./revalidation";

const NOT_IN_FUTURE_MESSAGE_FRAGMENT = "must be in the future";
const BEFORE_SCHEDULED_FOR_MESSAGE_FRAGMENT = "must not be before scheduled_for";
const INVALID_DUE_DATE: MaintenanceTodoActionState = {
  message: "延期する日付を正しく入力してください。",
  status: "error",
};

// Issue #19: pendingなOccurrenceのdue_atだけを未来日へ変更する。scheduled_for、
// 担当者、完了状態は変更しない(YDR-012)。実施者という概念はなく、操作主体と
// 操作日時だけをActivityLogへ記録する(YDR-020)。dueOnはYYYY-MM-DD形式で、
// メンテナンスTodo登録・完了記録と同じくAsia/Tokyoの日付として解釈する。
export async function postponeTaskOccurrence(
  managedItemId: string | null,
  occurrenceId: string,
  dueOn: string,
): Promise<MaintenanceTodoActionState> {
  const dueAtIso = tokyoDateToUtcIso(dueOn);
  if (dueAtIso === null) return INVALID_DUE_DATE;

  try {
    const { db, session } = await getD1Context();
    await postponeTaskOccurrenceInD1(db, session, occurrenceId, dueAtIso);
  } catch (error) {
    return mapRpcError(
      errorMessage(error),
      [
        {
          fragment: NOT_IN_FUTURE_MESSAGE_FRAGMENT,
          response: { message: "延期する日付は未来の日を指定してください。", status: "error" },
        },
        {
          fragment: BEFORE_SCHEDULED_FOR_MESSAGE_FRAGMENT,
          response: { message: "本来の予定日より前には延期できません。", status: "error" },
        },
        { fragment: CONFLICT_MESSAGE_FRAGMENT, response: STATE_CHANGED_ERROR },
      ],
      { message: "延期を記録できませんでした。時間をおいて再度お試しください。", status: "error" },
    );
  }

  revalidateTodoViews(managedItemId, occurrenceId);
  return {
    message: `${formatTokyoDate(dueAtIso)}まで延期しました。`,
    status: "success",
  };
}

const ONLY_ONE_TIME_SCHEDULE_MESSAGE_FRAGMENT = "Only one-time tasks can have an undated schedule";
const INVALID_SCHEDULE_DATE: MaintenanceTodoActionState = {
  message: "予定日を正しく入力してください。",
  status: "error",
};

async function updateTaskOccurrenceSchedule(
  managedItemId: string | null,
  occurrenceId: string,
  scheduledFor: string | null,
): Promise<MaintenanceTodoActionState | null> {
  try {
    const { db, session } = await getD1Context();
    await setOneTimeTaskScheduleInD1(db, session, occurrenceId, scheduledFor);
  } catch (error) {
    return mapRpcError(
      errorMessage(error),
      [
        {
          fragment: ONLY_ONE_TIME_SCHEDULE_MESSAGE_FRAGMENT,
          response: { message: "繰り返しTodoの予定日は未定にできません。", status: "error" },
        },
        { fragment: CONFLICT_MESSAGE_FRAGMENT, response: STATE_CHANGED_ERROR },
      ],
      { message: "予定日を変更できませんでした。時間をおいて再度お試しください。", status: "error" },
    );
  }
  revalidateTodoViews(managedItemId, occurrenceId);
  return null;
}

export async function setTaskOccurrenceSchedule(
  managedItemId: string | null,
  occurrenceId: string,
  scheduledOn: string,
): Promise<MaintenanceTodoActionState> {
  const scheduledFor = tokyoDateToUtcIso(scheduledOn);
  if (scheduledFor === null) return INVALID_SCHEDULE_DATE;
  const error = await updateTaskOccurrenceSchedule(managedItemId, occurrenceId, scheduledFor);
  return error ?? {
    message: `予定日を${formatTokyoDate(scheduledFor)}に設定しました。`,
    status: "success",
  };
}

export async function unsetTaskOccurrenceSchedule(
  managedItemId: string | null,
  occurrenceId: string,
): Promise<MaintenanceTodoActionState> {
  const error = await updateTaskOccurrenceSchedule(managedItemId, occurrenceId, null);
  return error ?? { message: "予定日を未定に戻しました。", status: "success" };
}
