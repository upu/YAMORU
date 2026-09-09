"use server";

import { getD1Context } from "../../../lib/d1/context";
import {
  claimTaskOccurrenceAssignee as claimTaskOccurrenceAssigneeInD1,
  setTaskOccurrenceAssignee as setTaskOccurrenceAssigneeInD1,
} from "../../../lib/d1/todos";
import type { MaintenanceTodoActionState } from "../state";
import {
  ASSIGNEE_NOT_FOUND_ERROR,
  mapTodoError,
  STATE_CHANGED_ERROR,
} from "./error-mapping";
import { revalidateTodoViews } from "./revalidation";

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
    return mapTodoError(
      error,
      {
        ASSIGNEE_NOT_FOUND: ASSIGNEE_NOT_FOUND_ERROR,
        OCCURRENCE_NOT_PENDING: STATE_CHANGED_ERROR,
      },
      { message: "担当を変更できませんでした。時間をおいて再度お試しください。", status: "error" },
    );
  }

  revalidateTodoViews(managedItemId, occurrenceId);
  return {
    message: "担当を変更しました。",
    status: "success",
  };
}

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
    return mapTodoError(
      error,
      {
        OCCURRENCE_ALREADY_ASSIGNED: {
          message: "すでに他の家族が担当しています。最新の状態を確認してください。",
          status: "error",
        },
        OCCURRENCE_NOT_PENDING: STATE_CHANGED_ERROR,
      },
      { message: "担当を開始できませんでした。時間をおいて再度お試しください。", status: "error" },
    );
  }

  revalidateTodoViews(managedItemId, occurrenceId);
  return {
    message: "担当にしました。",
    status: "success",
  };
}
