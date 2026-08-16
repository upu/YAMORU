"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "../lib/supabase/server";
import { tokyoDateToUtcIso } from "./time-zone";
import type { TodoActionState } from "./todo-state";

const TASK_TITLE_MAX_LENGTH = 100;

function invalidTitle(): TodoActionState {
  return {
    message: "Todo名は1文字以上100文字以内で入力してください。",
    status: "error",
  };
}

export async function createOneTimeTodo(
  _previousState: TodoActionState,
  formData: FormData,
): Promise<TodoActionState> {
  const rawTitle = formData.get("title");
  if (typeof rawTitle !== "string") return invalidTitle();

  const title = rawTitle.trim();
  if (title.length === 0 || Array.from(title).length > TASK_TITLE_MAX_LENGTH) {
    return invalidTitle();
  }

  const plannedDate = formData.get("plannedDate");
  const scheduledFor =
    typeof plannedDate === "string" ? tokyoDateToUtcIso(plannedDate) : null;
  if (scheduledFor === null) {
    return { message: "予定日を正しく入力してください。", status: "error" };
  }

  const rawManagedItemId = formData.get("managedItemId");
  const managedItemId =
    typeof rawManagedItemId === "string" && rawManagedItemId.length > 0
      ? rawManagedItemId
      : null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_one_time_task", {
    scheduled_for: scheduledFor,
    task_title: title,
    ...(managedItemId === null ? {} : { item_id: managedItemId }),
  });

  if (error !== null || typeof data !== "string") {
    return {
      message: "Todoを登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/");
  if (managedItemId !== null) {
    revalidatePath(`/managed-items/${encodeURIComponent(managedItemId)}`);
  }
  return { message: "Todoを登録しました。", status: "success" };
}
