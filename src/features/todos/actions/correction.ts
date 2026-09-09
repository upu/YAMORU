"use server";

import { getD1Context } from "../../../lib/d1/context";
import {
  correctCompletionOccurredAt as correctCompletionOccurredAtInD1,
  correctCompletionPerformer as correctCompletionPerformerInD1,
} from "../../../lib/d1/todos";
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
    return mapTodoError(
      error,
      {
        NEXT_OCCURRENCE_MODIFIED: CORRECTION_NEXT_OCCURRENCE_MODIFIED,
        NEXT_OCCURRENCE_SCHEDULE_TAKEN: SCHEDULE_COLLISION_ERROR,
        OCCURRENCE_NOT_COMPLETED: STATE_CHANGED_ERROR,
      },
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
    return mapTodoError(
      error,
      {
        OCCURRENCE_NOT_COMPLETED: STATE_CHANGED_ERROR,
        PERFORMER_NOT_FOUND: PERFORMER_NOT_FOUND_ERROR,
      },
      { message: "実施者を訂正できませんでした。時間をおいて再度お試しください。", status: "error" },
    );
  }

  revalidateTodoViews(managedItemId, occurrenceId);
  return {
    message: "実施者を訂正しました。",
    status: "success",
  };
}
