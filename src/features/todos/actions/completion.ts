"use server";

import { getD1Context } from "../../../lib/d1/context";
import { completeTask, undoTaskCompletion } from "../../../lib/d1/todos";
import { tokyoDateToUtcIso } from "../../../app/time-zone";
import type { MaintenanceTodoActionState } from "../state";
import {
  INVALID_OCCURRED_ON,
  mapTodoError,
  PERFORMER_NOT_FOUND_ERROR,
  SCHEDULE_COLLISION_ERROR,
  STATE_CHANGED_ERROR,
} from "./error-mapping";
import { revalidateTodoViews } from "./revalidation";

const GENERIC_COMPLETION_ERROR: MaintenanceTodoActionState = {
  message: "完了を記録できませんでした。時間をおいて再度お試しください。",
  status: "error",
};

function mapCompleteMaintenanceTaskError(error: unknown): MaintenanceTodoActionState {
  return mapTodoError(
    error,
    {
      NEXT_OCCURRENCE_SCHEDULE_TAKEN: SCHEDULE_COLLISION_ERROR,
      OCCURRENCE_NOT_PENDING: STATE_CHANGED_ERROR,
      PERFORMER_NOT_FOUND: PERFORMER_NOT_FOUND_ERROR,
    },
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
    return mapCompleteMaintenanceTaskError(error);
  }

  revalidateTodoViews(managedItemId, occurrenceId);
  return {
    message: "完了を記録しました。",
    status: "success",
  };
}

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
    return mapTodoError(
      error,
      {
        NEXT_OCCURRENCE_MODIFIED: {
          message: "次回Todoがすでに変更されているため自動取消できません。手動で訂正してください。",
          status: "error",
        },
        OCCURRENCE_NOT_COMPLETED: STATE_CHANGED_ERROR,
      },
      { message: "取消を記録できませんでした。時間をおいて再度お試しください。", status: "error" },
    );
  }

  revalidateTodoViews(managedItemId, occurrenceId);
  return {
    message: "完了の取消を記録しました。",
    status: "success",
  };
}
