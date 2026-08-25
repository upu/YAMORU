"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getD1Context } from "../../../lib/d1/context";
import { updateOneTimeTodo } from "../../../lib/d1/todos";
import type { MaintenanceTodoActionState } from "../../managed-items/[id]/state";
import { tokyoDateToUtcIso } from "../../time-zone";

const TASK_TITLE_MAX_LENGTH = 100;

type ParsedTodoEditForm =
  | {
      assigneeUserId: string | null;
      managedItemId: string | null;
      occurrenceId: string;
      scheduledFor: string | null;
      status: "ok";
      title: string;
    }
  | MaintenanceTodoActionState;

function optionalId(formData: FormData, field: string): string | null {
  const raw = formData.get(field);
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length === 0 ? null : value;
}

// 予定日は空欄を「未定」として受け取る(YDR-030)。日付の解釈はTodo登録・
// 予定日変更と同じくAsia/Tokyoの暦日に揃える。
function parseSchedule(
  formData: FormData,
): { status: "ok"; value: string | null } | MaintenanceTodoActionState {
  const raw = formData.get("plannedDate");
  if (typeof raw !== "string") {
    return { message: "予定日を正しく入力してください。", status: "error" };
  }
  if (raw === "") return { status: "ok", value: null };
  const scheduledFor = tokyoDateToUtcIso(raw);
  if (scheduledFor === null) {
    return { message: "予定日を正しく入力してください。", status: "error" };
  }
  return { status: "ok", value: scheduledFor };
}

function parseTodoEditForm(formData: FormData): ParsedTodoEditForm {
  const occurrenceId = optionalId(formData, "id");
  if (occurrenceId === null) {
    return { message: "対象のTodoを特定できませんでした。", status: "error" };
  }

  const rawTitle = formData.get("title");
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  if (title.length === 0 || Array.from(title).length > TASK_TITLE_MAX_LENGTH) {
    return {
      message: "Todo名は1文字以上100文字以内で入力してください。",
      status: "error",
    };
  }

  const schedule = parseSchedule(formData);
  if (schedule.status !== "ok") return schedule;

  return {
    assigneeUserId: optionalId(formData, "assigneeUserId"),
    managedItemId: optionalId(formData, "managedItemId"),
    occurrenceId,
    scheduledFor: schedule.value,
    status: "ok",
    title,
  };
}

const EDIT_ERROR_RULES: { fragment: string; message: string }[] = [
  {
    fragment: "Assignee not found",
    message: "担当者を指定できませんでした。同じ家庭のメンバーから選び直してください。",
  },
  {
    fragment: "Managed item not found",
    message: "関連する管理対象を指定できませんでした。同じ家庭の管理対象から選び直してください。",
  },
  {
    fragment: "Only one-time tasks can be edited",
    message: "繰り返しTodoの内容はこの画面から変更できません。",
  },
  {
    fragment: "Occurrence already exists for the schedule",
    message: "その予定日には同じTodoの別の予定があります。別の日付を指定してください。",
  },
  {
    fragment: "Occurrence not found",
    message: "対象のTodoが見つかりませんでした。最新の状態を確認してください。",
  },
  {
    fragment: "Occurrence is not pending",
    message: "他の操作で状態が変わりました。最新の状態を確認してください。",
  },
];

function mapEditError(error: unknown): MaintenanceTodoActionState {
  const message = error instanceof Error ? error.message : "";
  const matched = EDIT_ERROR_RULES.find((rule) => message.includes(rule.fragment));
  return matched === undefined
    ? { message: "Todoを更新できませんでした。時間をおいて再度お試しください。", status: "error" }
    : { message: matched.message, status: "error" };
}

// 保存後に反映する画面。ホーム(#36)、Todo一覧(#201)、Todo詳細と
// 編集画面、そして関連ManagedItemの詳細を、変更前後の両方について再検証する。
function revalidateTodoEditViews(
  occurrenceId: string,
  managedItemIds: (string | null)[],
): void {
  revalidatePath("/");
  revalidatePath("/todos");
  revalidatePath(`/todos/${encodeURIComponent(occurrenceId)}`);
  revalidatePath(`/todos/${encodeURIComponent(occurrenceId)}/edit`);
  for (const managedItemId of new Set(managedItemIds)) {
    if (managedItemId !== null) {
      revalidatePath(`/managed-items/${encodeURIComponent(managedItemId)}`);
    }
  }
}

// Issue #203: 繰り返しなしTodoの名前・関連ManagedItem・担当者・予定日を保存する。
// 対象のOccurrence IDはフォームの隠しフィールド(id)から受け取る
// (updateManagedItemと同じ、useActionStateのaction型を崩さない方式)。
// 他家庭のTodo・ManagedItem・メンバーはD1側が拒否する。
export async function updateTodo(
  _previousState: MaintenanceTodoActionState,
  formData: FormData,
): Promise<MaintenanceTodoActionState> {
  const parsed = parseTodoEditForm(formData);
  if (parsed.status !== "ok") return parsed;

  let previousManagedItemId: string | null;
  try {
    const { db, session } = await getD1Context();
    ({ previousManagedItemId } = await updateOneTimeTodo(db, session, parsed.occurrenceId, {
      assigneeUserId: parsed.assigneeUserId,
      managedItemId: parsed.managedItemId,
      scheduledFor: parsed.scheduledFor,
      title: parsed.title,
    }));
  } catch (error) {
    return mapEditError(error);
  }

  revalidateTodoEditViews(parsed.occurrenceId, [
    previousManagedItemId,
    parsed.managedItemId,
  ]);
  redirect(`/todos/${encodeURIComponent(parsed.occurrenceId)}`);
}
