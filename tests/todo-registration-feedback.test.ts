import { describe, expect, it } from "vitest";

import {
  type RegisteredTodoSchedule,
  summarizeRegisteredTodo,
  summarizeRegisteredTodoSafely,
} from "../src/app/todos/new/registration-feedback";

// Issue #286: 登録直後に返す「次回の予定」と「ホームにまだ出ない場合の確認先」。
// 判定はホーム・Todo一覧と同じ分類(pending-todo.ts)を使うため、ここでは
// 保存された内容から利用者に見える文言が組み立てられることを確かめる。

// Asia/Tokyoの暦日の00:00をISO文字列にする(保存されている予定日と同じ形)。
function tokyoIso(date: string): string {
  return new Date(`${date}T00:00:00+09:00`).toISOString();
}

// 家庭内での実例(issue本文の背景): 8月30日に「毎月15日」の定例Todoを登録した。
const NOW = tokyoIso("2026-08-30");

function strictTodo(dueOn: string | null): RegisteredTodoSchedule {
  const iso = dueOn === null ? null : tokyoIso(dueOn);
  return {
    deadlineKind: "strict",
    dueAt: iso,
    recurrenceBasis: dueOn === null ? "once" : "calendar",
    scheduledFor: iso,
    title: "翌月の予定表を提出する",
  };
}

function maintenanceTodo(from: string, until: string): RegisteredTodoSchedule {
  return {
    deadlineKind: "maintenance",
    dueAt: tokyoIso(until),
    recurrenceBasis: "completion",
    scheduledFor: tokyoIso(from),
    title: "換気扇の掃除",
  };
}

describe("Todo登録直後のフィードバック", () => {
  it("7日より先の厳密な期限Todoは、次回とホームに出る日・確認先を伝える", () => {
    expect(summarizeRegisteredTodo(strictTodo("2026-09-15"), NOW)).toEqual({
      homeNotice:
        "9月8日からホームの「近日」に表示されます。それまではTodo一覧で確認できます。",
      schedule: "次回: 9月15日",
    });
  });

  it("7日以内の予定はホームへすぐ出るため、次回だけを伝える", () => {
    expect(summarizeRegisteredTodo(strictTodo("2026-09-06"), NOW)).toEqual({
      homeNotice: null,
      schedule: "次回: 9月6日",
    });
  });

  it("今日が予定日のTodoもホームへ出るため、案内を重ねない", () => {
    expect(summarizeRegisteredTodo(strictTodo("2026-08-30"), NOW)).toEqual({
      homeNotice: null,
      schedule: "次回: 8月30日",
    });
  });

  // YDR-030 / Issue #202: 予定日未定Todoはホームに出ない。
  it("予定日未定のTodoは、未定であることと確認先を伝える", () => {
    expect(summarizeRegisteredTodo(strictTodo(null), NOW)).toEqual({
      homeNotice: "予定日が決まるまでホームには表示されません。Todo一覧で確認できます。",
      schedule: "予定日: 未定",
    });
  });

  // YDR-034: 完了日基準Todoは推奨期間に入るまでホームに出ない。
  it("推奨期間前の完了日基準Todoは、推奨期間の開始と表示開始日を伝える", () => {
    expect(summarizeRegisteredTodo(maintenanceTodo("2026-09-06", "2026-09-13"), NOW))
      .toEqual({
        homeNotice:
          "9月6日からホームの「メンテナンス」に表示されます。それまではTodo一覧で確認できます。",
        schedule: "推奨期間: 9月6日から",
      });
  });

  it("推奨期間に入っている完了日基準Todoは、上限日だけを伝える", () => {
    expect(summarizeRegisteredTodo(maintenanceTodo("2026-08-30", "2026-09-06"), NOW))
      .toEqual({
        homeNotice: null,
        schedule: "推奨期間: 9月6日まで",
      });
  });
});

describe("要約を組み立てられないTodo", () => {
  // 予定日と期限の組み合わせが壊れている場合、分類(pending-todo.ts)は例外を
  // 投げる。保存はすでに成功しているため、登録失敗として扱わず表示だけを落とす。
  const BROKEN: RegisteredTodoSchedule = {
    deadlineKind: "strict",
    dueAt: null,
    // 予定日未定を使えるのは繰り返しなしのTodoだけ(YDR-030)。
    recurrenceBasis: "calendar",
    scheduledFor: null,
    title: "壊れた予定のTodo",
  };

  it("分類できない保存内容では例外を投げる", () => {
    expect(() => summarizeRegisteredTodo(BROKEN, NOW)).toThrow();
  });

  it("安全版は例外を吸収し、要約なしを返す", () => {
    expect(summarizeRegisteredTodoSafely(BROKEN, NOW)).toBeUndefined();
  });

  it("組み立てられる保存内容では、安全版も同じ要約を返す", () => {
    expect(summarizeRegisteredTodoSafely(strictTodo("2026-09-15"), NOW))
      .toEqual(summarizeRegisteredTodo(strictTodo("2026-09-15"), NOW));
  });
});
