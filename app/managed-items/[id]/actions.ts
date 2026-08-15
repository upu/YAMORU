"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "../../../lib/supabase/server";
import type { MaintenanceTodoActionState } from "./state";
import { addDaysToTokyoDateUtcIso, tokyoDateToUtcIso } from "../../time-zone";

const TASK_TITLE_MAX_LENGTH = 100;
const MAX_RECOMMENDED_OFFSET = 3650;
const INVALID_OFFSETS: MaintenanceTodoActionState = {
  message: "次回の目安は0以上の整数で、短い方を長い方以下にしてください。",
  status: "error",
};
const INVALID_WINDOW: MaintenanceTodoActionState = {
  message: "初回の計算に使う有効な日付を入力してください。",
  status: "error",
};
const INVALID_DATE_MODE: MaintenanceTodoActionState = {
  message: "初回の決め方を選択してください。",
  status: "error",
};
const INTERVAL_UNIT_DAYS = { day: 1, week: 7 } as const;

type MaintenanceTodoInput = {
  firstDueAt: string;
  firstScheduledFor: string;
  recommendedStartOffset: number;
  recommendedUntilOffset: number;
  title: string;
};
type RecommendedOffsets = {
  recommendedStartOffset: number;
  recommendedUntilOffset: number;
};
type FirstWindow = { firstDueAt: string; firstScheduledFor: string };

function invalidTitle(): MaintenanceTodoActionState {
  return {
    message: "Todo名は1文字以上100文字以内で入力してください。",
    status: "error",
  };
}

function parseOffset(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const offset = Number(value);
  return Number.isSafeInteger(offset) ? offset : null;
}

function parseRecommendedOffsets(
  formData: FormData,
): RecommendedOffsets | MaintenanceTodoActionState {
  const intervalMin = parseOffset(formData.get("intervalMin"));
  const intervalMax = parseOffset(formData.get("intervalMax"));
  const rawUnit = formData.get("intervalUnit");
  if (
    intervalMin === null ||
    intervalMax === null ||
    typeof rawUnit !== "string" ||
    (rawUnit !== "day" && rawUnit !== "week")
  ) {
    return INVALID_OFFSETS;
  }

  const multiplier = INTERVAL_UNIT_DAYS[rawUnit];
  const recommendedStartOffset = intervalMin * multiplier;
  const recommendedUntilOffset = intervalMax * multiplier;
  if (
    recommendedStartOffset > recommendedUntilOffset ||
    recommendedUntilOffset > MAX_RECOMMENDED_OFFSET
  ) {
    return INVALID_OFFSETS;
  }
  return { recommendedStartOffset, recommendedUntilOffset };
}

function parseFirstWindow(
  formData: FormData,
  offsets: RecommendedOffsets,
): FirstWindow | MaintenanceTodoActionState {
  const mode = formData.get("initialDateMode");
  if (mode !== "previous_completion" && mode !== "next_window_start") {
    return INVALID_DATE_MODE;
  }

  const anchorDate = formData.get("anchorDate");
  if (typeof anchorDate !== "string") return INVALID_WINDOW;
  const startDays = mode === "previous_completion"
    ? offsets.recommendedStartOffset
    : 0;
  const dueDays = mode === "previous_completion"
    ? offsets.recommendedUntilOffset
    : offsets.recommendedUntilOffset - offsets.recommendedStartOffset;
  const firstScheduledFor = addDaysToTokyoDateUtcIso(anchorDate, startDays);
  const firstDueAt = addDaysToTokyoDateUtcIso(anchorDate, dueDays);
  if (firstScheduledFor === null || firstDueAt === null) return INVALID_WINDOW;
  return { firstDueAt, firstScheduledFor };
}

function parseMaintenanceTodoInput(
  formData: FormData,
): MaintenanceTodoInput | MaintenanceTodoActionState {
  const rawTitle = formData.get("title");
  if (typeof rawTitle !== "string") return invalidTitle();

  const title = rawTitle.trim();
  if (title.length === 0 || Array.from(title).length > TASK_TITLE_MAX_LENGTH) {
    return invalidTitle();
  }

  const offsets = parseRecommendedOffsets(formData);
  if ("status" in offsets) return offsets;
  const firstWindow = parseFirstWindow(formData, offsets);
  if ("status" in firstWindow) return firstWindow;

  return {
    ...firstWindow,
    ...offsets,
    title,
  };
}

export async function createMaintenanceTodo(
  managedItemId: string,
  _previousState: MaintenanceTodoActionState,
  formData: FormData,
): Promise<MaintenanceTodoActionState> {
  const input = parseMaintenanceTodoInput(formData);
  if ("status" in input) return input;

  const supabase = await createClient();
  const response = await supabase.rpc("create_maintenance_task", {
    first_due_at: input.firstDueAt,
    first_scheduled_for: input.firstScheduledFor,
    item_id: managedItemId,
    recommended_start_offset: input.recommendedStartOffset,
    recommended_until_offset: input.recommendedUntilOffset,
    task_title: input.title,
  });
  const data: unknown = response.data;
  const error: unknown = response.error;

  if (error !== null || typeof data !== "string") {
    return {
      message: "メンテナンスTodoを登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath(`/managed-items/${encodeURIComponent(managedItemId)}`);
  return {
    message: "メンテナンスTodoを登録しました。",
    status: "success",
  };
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
  if (message.includes(PERFORMER_NOT_FOUND_MESSAGE_FRAGMENT)) {
    return {
      message: "実施した人を指定できませんでした。同じ家庭のメンバーから選び直してください。",
      status: "error",
    };
  }
  if (message.includes(CONFLICT_MESSAGE_FRAGMENT)) {
    return {
      message: "他の操作で状態が変わりました。最新の状態を確認してください。",
      status: "error",
    };
  }
  if (message.includes(SCHEDULE_COLLISION_MESSAGE_FRAGMENT)) {
    return {
      message: "その実施日では次回の予定が既存のTodoと重なります。別の日付を指定してください。",
      status: "error",
    };
  }
  return GENERIC_COMPLETION_ERROR;
}

// occurredOnはnull(現在時刻で完了)か、実施日の日付文字列(YYYY-MM-DD)。
// 日付はメンテナンスTodo登録と同じくAsia/Tokyoの日付として解釈する。
// performedByUserIdはnull(実施者=操作主体、既定)か、同じ家庭のメンバーのuser_id
// (「詳しく記録する」で選択した実施者、Issue #18, YDR-020)。
export async function completeMaintenanceTask(
  managedItemId: string,
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

  revalidatePath(`/managed-items/${encodeURIComponent(managedItemId)}`);
  // ホーム(Issue #36)も同じ完了・活動履歴を表示するため、ここで再検証する。
  revalidatePath("/");
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
  managedItemId: string,
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
    if (error.message.includes(ASSIGNEE_NOT_FOUND_MESSAGE_FRAGMENT)) {
      return {
        message: "担当者を指定できませんでした。同じ家庭のメンバーから選び直してください。",
        status: "error",
      };
    }
    if (error.message.includes(CONFLICT_MESSAGE_FRAGMENT)) {
      return {
        message: "他の操作で状態が変わりました。最新の状態を確認してください。",
        status: "error",
      };
    }
    return {
      message: "担当を変更できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath(`/managed-items/${encodeURIComponent(managedItemId)}`);
  // ホーム(Issue #36)も同じTodoの担当を表示するため、ここで再検証する。
  revalidatePath("/");
  return {
    message: "担当を変更しました。",
    status: "success",
  };
}

const NOT_COMPLETED_MESSAGE_FRAGMENT = "is not completed";
const NEXT_OCCURRENCE_MODIFIED_MESSAGE_FRAGMENT = "Next occurrence has been modified";

// Issue #37: 直近の完了を取り消す。取消自体はバックデートしない(YDR-004は完了だけを対象とする)。
export async function undoMaintenanceTaskCompletion(
  managedItemId: string,
  occurrenceId: string,
  idempotencyKey: string,
): Promise<MaintenanceTodoActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("undo_maintenance_task_completion", {
    idempotency_key: idempotencyKey,
    occurrence_id: occurrenceId,
  });

  if (error !== null) {
    if (error.message.includes(NEXT_OCCURRENCE_MODIFIED_MESSAGE_FRAGMENT)) {
      return {
        message: "次回Todoがすでに変更されているため自動取消できません。手動で訂正してください。",
        status: "error",
      };
    }
    if (error.message.includes(NOT_COMPLETED_MESSAGE_FRAGMENT)) {
      return {
        message: "他の操作で状態が変わりました。最新の状態を確認してください。",
        status: "error",
      };
    }
    return {
      message: "取消を記録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath(`/managed-items/${encodeURIComponent(managedItemId)}`);
  // ホーム(Issue #36)も同じ完了・活動履歴を表示するため、ここで再検証する。
  revalidatePath("/");
  return {
    message: "完了の取消を記録しました。",
    status: "success",
  };
}
