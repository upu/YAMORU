import type { PendingOccurrenceRow } from "../../../lib/d1/home";
import type { MaintenanceTodoActionState } from "../../managed-items/[id]/state";
import {
  buildPendingTodoEntries,
  HOME_UPCOMING_DAYS,
  isHomePendingCategory,
  type PendingTodoEntry,
} from "../../pending-todo";
import type {
  DeadlineKind,
  RecurrenceBasis,
  TodoListSchedule,
} from "../../task-schedule";
import {
  addDaysToTokyoDateUtcIso,
  formatTokyoDateInput,
  formatTokyoMonthDay,
} from "../../time-zone";

// Issue #286: Todo登録の直後に、保存された内容そのものから「次回の予定」と
// 「まだホームに出ないなら、いつ・どこで確認できるか」を返す。
//
// 予定の意味づけ(次回の期日か、推奨期間の開始か、予定日未定か)も、ホームに
// 載る区分かどうかも、ホーム・Todo一覧と同じpending-todo.tsの分類結果を使う。
// この画面だけの独自計算は持たないため、ホームの表示基準を変えない限り
// 案内もずれない。

export type RegisteredTodoSchedule = {
  deadlineKind: DeadlineKind;
  dueAt: string | null;
  recurrenceBasis: RecurrenceBasis;
  scheduledFor: string | null;
  title: string;
};

// 登録フォームの状態。エラー・初期状態は既存のMaintenanceTodoActionStateの
// ままとし、成功したときだけ登録内容の要約を添える。
export type TodoRegistrationState = MaintenanceTodoActionState & {
  registered?: RegisteredTodoSummary;
};

export type RegisteredTodoSummary = {
  // ホームにまだ出ないTodoにだけ添える案内。出るTodoでは冗長なためnull。
  homeNotice: string | null;
  // 「次回: 9月15日」「推奨期間: 9月8日から」「予定日: 未定」。
  schedule: string;
};

function describeSchedule(schedule: TodoListSchedule | undefined): string {
  if (schedule === undefined || schedule.kind === "undated") return "予定日: 未定";
  const date = formatTokyoMonthDay(schedule.iso);
  if (schedule.kind === "from") return `推奨期間: ${date}から`;
  if (schedule.kind === "until") return `推奨期間: ${date}まで`;
  return `次回: ${date}`;
}

// ホームの「近日」は予定日のHOME_UPCOMING_DAYS日前から表示するため、
// 表示が始まる日は期日からその日数を戻した暦日になる(pending-todo.ts)。
function homeUpcomingStartsOn(dueAt: string): string | null {
  return addDaysToTokyoDateUtcIso(
    formatTokyoDateInput(dueAt),
    -HOME_UPCOMING_DAYS,
  );
}

function describeLaterNotice(dueAt: string | null): string | null {
  if (dueAt === null) return null;
  const startsOn = homeUpcomingStartsOn(dueAt);
  if (startsOn === null) return null;
  return `${formatTokyoMonthDay(startsOn)}からホームの「近日」に表示されます。`;
}

// 完了日基準Todoは推奨期間に入るとホームの「メンテナンス」へ出る(YDR-034)。
function describeBeforeWindowNotice(scheduledFor: string | null): string | null {
  if (scheduledFor === null) return null;
  return `${formatTokyoMonthDay(scheduledFor)}からホームの「メンテナンス」に表示されます。`;
}

// ホームに出ないTodoは「登録できていないのでは」と受け取られやすい
// (issue本文の背景)。そこで、いつホームへ出るか、それまでどこで確認できるかを
// 一文で添える。ホームへ出るTodoには添えない。
function describeHomeNotice(
  entry: PendingTodoEntry,
  saved: RegisteredTodoSchedule,
): string | null {
  if (isHomePendingCategory(entry.category)) return null;
  if (entry.category === "undated") {
    return "予定日が決まるまでホームには表示されません。Todo一覧で確認できます。";
  }
  const appearsOn = entry.category === "before-window"
    ? describeBeforeWindowNotice(saved.scheduledFor)
    : describeLaterNotice(saved.dueAt);
  if (appearsOn === null) return "ホームにはまだ表示されません。Todo一覧で確認できます。";
  return `${appearsOn}それまではTodo一覧で確認できます。`;
}

// 分類はホーム・Todo一覧と同じ入力(PendingOccurrenceRow)から行う。まだ画面に
// 並べないため、行の識別子や担当予定者・管理対象は分類に影響しない値を置く。
function registeredRow(saved: RegisteredTodoSchedule): PendingOccurrenceRow {
  return {
    assignee_user_id: null,
    due_at: saved.dueAt,
    id: "registered",
    scheduled_for: saved.scheduledFor,
    task_rules: {
      deadline_kind: saved.deadlineKind,
      managed_items: null,
      recurrence_basis: saved.recurrenceBasis,
      title: saved.title,
    },
  };
}

// 保存はすでに成功しているため、要約を組み立てられなくても登録失敗にはしない。
// 予定日と期限の組み合わせが壊れている場合(pending-todo.tsが投げる)は、
// 「Todoを登録しました。」だけの表示へ落として登録結果を伝える。
export function summarizeRegisteredTodoSafely(
  saved: RegisteredTodoSchedule,
  nowIso: string,
): RegisteredTodoSummary | undefined {
  try {
    return summarizeRegisteredTodo(saved, nowIso);
  } catch {
    return undefined;
  }
}

export function summarizeRegisteredTodo(
  saved: RegisteredTodoSchedule,
  nowIso: string,
): RegisteredTodoSummary {
  const entry = buildPendingTodoEntries([registeredRow(saved)], nowIso).at(0);
  if (entry === undefined) {
    throw new Error("登録したTodoの予定を判定できませんでした。");
  }
  return {
    homeNotice: describeHomeNotice(entry, saved),
    schedule: describeSchedule(entry.item.listSchedule),
  };
}
