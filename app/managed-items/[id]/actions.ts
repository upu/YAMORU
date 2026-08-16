"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "../../../lib/supabase/server";
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

// メンテナンスTodoの状態を表示する画面(詳細・ホーム、Issue #36)を両方
// 再検証する。完了・担当変更・延期・完了取消はいずれも両画面へ反映されるため
// 同じペアを呼ぶ。
function revalidateManagedItemAndHome(managedItemId: string | null): void {
  if (managedItemId !== null) {
    revalidatePath(`/managed-items/${encodeURIComponent(managedItemId)}`);
  }
  revalidatePath("/");
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

  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_maintenance_task", {
    idempotency_key: idempotencyKey,
    occurrence_id: occurrenceId,
    ...(occurredAtIso === null ? {} : { occurred_at: occurredAtIso }),
    // 省略時はRPC側のdefault nullが操作主体を実施者として使う
    // (setTaskOccurrenceAssigneeのnew_assignee_user_idと同じ回避方法)。
    ...(performedByUserId === null ? {} : { performed_by_user_id: performedByUserId }),
  });

  if (error !== null) return mapCompleteMaintenanceTaskError(error.message);

  revalidateManagedItemAndHome(managedItemId);
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
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_task_occurrence_assignee", {
    occurrence_id: occurrenceId,
    // assigneeUserIdがnull(解除)の場合はキー自体を省略する。RPC側の
    // default nullが同じ意味になり、生成された型はnull非許容のため
    // (complete_maintenance_taskのoccurred_atと同じ回避方法)。
    ...(assigneeUserId === null ? {} : { new_assignee_user_id: assigneeUserId }),
  });

  if (error !== null) {
    return mapRpcError(
      error.message,
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

  revalidateManagedItemAndHome(managedItemId);
  return {
    message: "担当を変更しました。",
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

  const supabase = await createClient();
  const { error } = await supabase.rpc("postpone_task_occurrence", {
    new_due_at: dueAtIso,
    occurrence_id: occurrenceId,
  });

  if (error !== null) {
    return mapRpcError(
      error.message,
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

  revalidateManagedItemAndHome(managedItemId);
  return {
    message: `${formatTokyoDate(dueAtIso)}まで延期しました。`,
    status: "success",
  };
}

const NOT_COMPLETED_MESSAGE_FRAGMENT = "is not completed";
const NEXT_OCCURRENCE_MODIFIED_MESSAGE_FRAGMENT = "Next occurrence has been modified";

// Issue #37: 直近の完了を取り消す。取消自体はバックデートしない(YDR-004は完了だけを対象とする)。
export async function undoMaintenanceTaskCompletion(
  managedItemId: string | null,
  occurrenceId: string,
  idempotencyKey: string,
): Promise<MaintenanceTodoActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("undo_maintenance_task_completion", {
    idempotency_key: idempotencyKey,
    occurrence_id: occurrenceId,
  });

  if (error !== null) {
    return mapRpcError(
      error.message,
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

  revalidateManagedItemAndHome(managedItemId);
  return {
    message: "完了の取消を記録しました。",
    status: "success",
  };
}
