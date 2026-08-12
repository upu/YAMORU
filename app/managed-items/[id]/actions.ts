"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "../../../lib/supabase/server";
import type { MaintenanceTodoActionState } from "./state";
import { addDaysToTokyoDateUtcIso } from "./time-zone";

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
