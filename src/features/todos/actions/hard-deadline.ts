"use server";
import { getD1Context } from "../../../lib/d1/context";
import { setTaskHardDeadline as saveDeadline } from "../../../lib/d1/todos";
import { tokyoDateToUtcIso } from "../../../app/time-zone";
import type { MaintenanceTodoActionState } from "../state";
import { mapTodoError, STATE_CHANGED_ERROR } from "./error-mapping";
import { revalidateTodoViews } from "./revalidation";

export async function setTaskHardDeadline(
  managedItemId: string | null, occurrenceId: string, date: string, expected: string | null,
): Promise<MaintenanceTodoActionState> {
  if ((date !== "" && tokyoDateToUtcIso(date) === null) || (expected !== null && tokyoDateToUtcIso(expected) === null)) {
    return { status: "error", message: "必達日を正しく入力してください。" };
  }
  try {
    const { db, session } = await getD1Context();
    await saveDeadline(db, session, occurrenceId, date || null, expected);
  } catch (error) {
    return mapTodoError(error, {
      HARD_DEADLINE_CHANGED: { status: "error", message: "必達日が変更されています。再読み込みして確認してください。" },
      OCCURRENCE_NOT_PENDING: STATE_CHANGED_ERROR,
    }, { status: "error", message: "必達日を保存できませんでした。時間をおいて再度お試しください。" });
  }
  revalidateTodoViews(managedItemId, occurrenceId);
  return { status: "success", message: date ? "必達日を保存しました。" : "必達日を解除しました。" };
}
