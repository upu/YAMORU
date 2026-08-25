"use server";

import { revalidatePath } from "next/cache";

import { getD1Context } from "../../../lib/d1/context";
import {
  claimTaskOccurrenceAssignee as claimTaskOccurrenceAssigneeInD1,
  completeTask,
  correctCompletionOccurredAt as correctCompletionOccurredAtInD1,
  correctCompletionPerformer as correctCompletionPerformerInD1,
  postponeTaskOccurrence as postponeTaskOccurrenceInD1,
  setOneTimeTaskSchedule as setOneTimeTaskScheduleInD1,
  setTaskOccurrenceAssignee as setTaskOccurrenceAssigneeInD1,
  undoTaskCompletion,
} from "../../../lib/d1/todos";
import type { MaintenanceTodoActionState } from "./state";
import {
  formatTokyoDate,
  tokyoDateToUtcIso,
} from "../../time-zone";

// RPCのエラーメッセージに含まれる断片から、利用者向けの案内文へ変換する。
// 各actionは断片と応答の対応表(先勝ち)をこの関数へ渡すだけでよく、
// if文の連なりを重複させない(complete/assignee/postpone/undoの4箇所で
// 同じ形のマッピングが必要になるため)。
type RpcErrorRule = { fragment: string; response: MaintenanceTodoActionState };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function mapRpcError(
  message: string,
  rules: RpcErrorRule[],
  fallback: MaintenanceTodoActionState,
): MaintenanceTodoActionState {
  const matched = rules.find((rule) => message.includes(rule.fragment));
  return matched === undefined ? fallback : matched.response;
}

// 「他の操作で状態が変わりました」は、pending/completed限定のRPCが条件付き
// 更新に負けたときの共通の案内文。RPCごとに検知する断片文字列は異なるが
// (「is not pending」「is not completed」)、利用者への案内は同じにする。
const STATE_CHANGED_ERROR: MaintenanceTodoActionState = {
  message: "他の操作で状態が変わりました。最新の状態を確認してください。",
  status: "error",
};

// Todoの状態を表示する画面(ManagedItem詳細・ホーム、Issue #36、Todo一覧、
// Issue #201、Todo詳細、Issue #203・#205)をまとめて再検証する。完了・
// 担当変更・延期・予定日変更・完了取消・実施記録の訂正はいずれも同じ画面群へ
// 反映されるため、同じ組を呼ぶ。
function revalidateTodoViews(
  managedItemId: string | null,
  occurrenceId: string,
): void {
  if (managedItemId !== null) {
    revalidatePath(`/managed-items/${encodeURIComponent(managedItemId)}`);
  }
  revalidatePath("/");
  revalidatePath("/todos");
  revalidatePath(`/todos/${encodeURIComponent(occurrenceId)}`);
}

const CONFLICT_MESSAGE_FRAGMENT = "is not pending";
const SCHEDULE_COLLISION_MESSAGE_FRAGMENT = "already exists for the computed schedule";
const PERFORMER_NOT_FOUND_MESSAGE_FRAGMENT = "Performer not found";
const INVALID_OCCURRED_ON: MaintenanceTodoActionState = {
  message: "実施日を正しく入力してください。",
  status: "error",
};
const GENERIC_COMPLETION_ERROR: MaintenanceTodoActionState = {
  message: "完了を記録できませんでした。時間をおいて再度お試しください。",
  status: "error",
};

function mapCompleteMaintenanceTaskError(message: string): MaintenanceTodoActionState {
  return mapRpcError(
    message,
    [
      {
        fragment: PERFORMER_NOT_FOUND_MESSAGE_FRAGMENT,
        response: {
          message: "実施した人を指定できませんでした。同じ家庭のメンバーから選び直してください。",
          status: "error",
        },
      },
      { fragment: CONFLICT_MESSAGE_FRAGMENT, response: STATE_CHANGED_ERROR },
      {
        fragment: SCHEDULE_COLLISION_MESSAGE_FRAGMENT,
        response: {
          message: "その実施日では次回の予定が既存のTodoと重なります。別の日付を指定してください。",
          status: "error",
        },
      },
    ],
    GENERIC_COMPLETION_ERROR,
  );
}

// occurredOnはnull(現在時刻で完了)か、実施日の日付文字列(YYYY-MM-DD)。
// 日付はメンテナンスTodo登録と同じくAsia/Tokyoの日付として解釈する。
// performedByUserIdはnull(実施者=操作主体、既定)か、同じ家庭のメンバーのuser_id
// (「詳しく記録する」で選択した実施者、Issue #18, YDR-020)。
export async function completeMaintenanceTask(
  managedItemId: string | null,
  occurrenceId: string,
  idempotencyKey: string,
  occurredOn: string | null,
  performedByUserId: string | null,
): Promise<MaintenanceTodoActionState> {
  let occurredAtIso: string | null = null;
  if (occurredOn !== null) {
    occurredAtIso = tokyoDateToUtcIso(occurredOn);
    if (occurredAtIso === null) return INVALID_OCCURRED_ON;
  }

  try {
    const { db, session } = await getD1Context();
    await completeTask(db, session, {
      idempotencyKey,
      occurredAt: occurredAtIso,
      occurrenceId,
      performedByUserId,
    });
  } catch (error) {
    return mapCompleteMaintenanceTaskError(errorMessage(error));
  }

  revalidateTodoViews(managedItemId, occurrenceId);
  return {
    message: "完了を記録しました。",
    status: "success",
  };
}

const ASSIGNEE_NOT_FOUND_MESSAGE_FRAGMENT = "Assignee not found";

// Issue #72: pendingなOccurrenceの担当者を設定・解除する。assigneeUserIdが
// nullの場合は「誰でも可」へ解除する。scheduled_for, due_at, status, 次回
// Occurrenceの生成は行わない(set_task_occurrence_assignee RPCの契約、YDR-020)。
export async function setTaskOccurrenceAssignee(
  managedItemId: string | null,
  occurrenceId: string,
  assigneeUserId: string | null,
): Promise<MaintenanceTodoActionState> {
  try {
    const { db, session } = await getD1Context();
    await setTaskOccurrenceAssigneeInD1(db, session, occurrenceId, assigneeUserId);
  } catch (error) {
    return mapRpcError(
      errorMessage(error),
      [
        {
          fragment: ASSIGNEE_NOT_FOUND_MESSAGE_FRAGMENT,
          response: {
            message: "担当者を指定できませんでした。同じ家庭のメンバーから選び直してください。",
            status: "error",
          },
        },
        { fragment: CONFLICT_MESSAGE_FRAGMENT, response: STATE_CHANGED_ERROR },
      ],
      { message: "担当を変更できませんでした。時間をおいて再度お試しください。", status: "error" },
    );
  }

  revalidateTodoViews(managedItemId, occurrenceId);
  return {
    message: "担当を変更しました。",
    status: "success",
  };
}

const ALREADY_ASSIGNED_MESSAGE_FRAGMENT = "already has an assignee";

// Issue #77: 未担当のpending Occurrenceを、操作主体自身の担当として一操作で
// 引き受ける(「やるよ」)。対象は常にセッション自身で、クライアントからは
// 担当者IDを受け取らない(YDR-020)。既に誰かが担当している場合は黙って
// 上書きせず、案内だけ返す。
export async function claimTaskOccurrenceAssignee(
  managedItemId: string | null,
  occurrenceId: string,
): Promise<MaintenanceTodoActionState> {
  try {
    const { db, session } = await getD1Context();
    await claimTaskOccurrenceAssigneeInD1(db, session, occurrenceId);
  } catch (error) {
    return mapRpcError(
      errorMessage(error),
      [
        {
          fragment: ALREADY_ASSIGNED_MESSAGE_FRAGMENT,
          response: {
            message: "すでに他の家族が担当しています。最新の状態を確認してください。",
            status: "error",
          },
        },
        { fragment: CONFLICT_MESSAGE_FRAGMENT, response: STATE_CHANGED_ERROR },
      ],
      { message: "担当を開始できませんでした。時間をおいて再度お試しください。", status: "error" },
    );
  }

  revalidateTodoViews(managedItemId, occurrenceId);
  return {
    message: "担当にしました。",
    status: "success",
  };
}

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

const NOT_COMPLETED_MESSAGE_FRAGMENT = "is not completed";
const NEXT_OCCURRENCE_MODIFIED_MESSAGE_FRAGMENT = "Next occurrence has been modified";

// Issue #37: 直近の完了を取り消す。取消自体はバックデートしない(YDR-004は完了だけを対象とする)。
export async function undoMaintenanceTaskCompletion(
  managedItemId: string | null,
  occurrenceId: string,
  idempotencyKey: string,
): Promise<MaintenanceTodoActionState> {
  try {
    const { db, session } = await getD1Context();
    await undoTaskCompletion(db, session, occurrenceId, idempotencyKey);
  } catch (error) {
    return mapRpcError(
      errorMessage(error),
      [
        {
          fragment: NEXT_OCCURRENCE_MODIFIED_MESSAGE_FRAGMENT,
          response: {
            message: "次回Todoがすでに変更されているため自動取消できません。手動で訂正してください。",
            status: "error",
          },
        },
        { fragment: NOT_COMPLETED_MESSAGE_FRAGMENT, response: STATE_CHANGED_ERROR },
      ],
      { message: "取消を記録できませんでした。時間をおいて再度お試しください。", status: "error" },
    );
  }

  revalidateTodoViews(managedItemId, occurrenceId);
  return {
    message: "完了の取消を記録しました。",
    status: "success",
  };
}

// Issue #148: 完了取消の「後続Todoが変更済みで戻せない」と文言を変えるための
// 専用メッセージ。訂正自体は元のcompletedログを書き換えず、
// completion_correctionsへ追記する(YDR-026)。
const CORRECTION_NEXT_OCCURRENCE_MODIFIED: MaintenanceTodoActionState = {
  message: "次回Todoがすでに変更されているため、実施日時を訂正できません。次回Todoを手動で調整してください。",
  status: "error",
};

// occurredOnは実施日の日付文字列(YYYY-MM-DD、Asia/Tokyo)。完了記録・完了取消
// と同じ形式にする。
export async function correctCompletionOccurredAt(
  managedItemId: string | null,
  occurrenceId: string,
  idempotencyKey: string,
  occurredOn: string,
): Promise<MaintenanceTodoActionState> {
  const occurredAtIso = tokyoDateToUtcIso(occurredOn);
  if (occurredAtIso === null) return INVALID_OCCURRED_ON;

  try {
    const { db, session } = await getD1Context();
    await correctCompletionOccurredAtInD1(db, session, occurrenceId, idempotencyKey, occurredAtIso);
  } catch (error) {
    return mapRpcError(
      errorMessage(error),
      [
        { fragment: NEXT_OCCURRENCE_MODIFIED_MESSAGE_FRAGMENT, response: CORRECTION_NEXT_OCCURRENCE_MODIFIED },
        { fragment: NOT_COMPLETED_MESSAGE_FRAGMENT, response: STATE_CHANGED_ERROR },
        {
          fragment: SCHEDULE_COLLISION_MESSAGE_FRAGMENT,
          response: {
            message: "その実施日では次回の予定が既存のTodoと重なります。別の日付を指定してください。",
            status: "error",
          },
        },
      ],
      { message: "実施日時を訂正できませんでした。時間をおいて再度お試しください。", status: "error" },
    );
  }

  revalidateTodoViews(managedItemId, occurrenceId);
  return {
    message: "実施日時を訂正しました。",
    status: "success",
  };
}

// performedByUserIdは同じ家庭のログイン済みメンバーのuser_id(YDR-020)。
export async function correctCompletionPerformer(
  managedItemId: string | null,
  occurrenceId: string,
  idempotencyKey: string,
  performedByUserId: string,
): Promise<MaintenanceTodoActionState> {
  try {
    const { db, session } = await getD1Context();
    await correctCompletionPerformerInD1(db, session, occurrenceId, idempotencyKey, performedByUserId);
  } catch (error) {
    return mapRpcError(
      errorMessage(error),
      [
        {
          fragment: PERFORMER_NOT_FOUND_MESSAGE_FRAGMENT,
          response: {
            message: "実施した人を指定できませんでした。同じ家庭のメンバーから選び直してください。",
            status: "error",
          },
        },
        { fragment: NOT_COMPLETED_MESSAGE_FRAGMENT, response: STATE_CHANGED_ERROR },
      ],
      { message: "実施者を訂正できませんでした。時間をおいて再度お試しください。", status: "error" },
    );
  }

  revalidateTodoViews(managedItemId, occurrenceId);
  return {
    message: "実施者を訂正しました。",
    status: "success",
  };
}
