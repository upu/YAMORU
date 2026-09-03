import { describe, expect, it } from "vitest";

import { recurringRuleValues } from "../src/app/todos/[id]/edit/recurring-todo-edit-values";
import { type TodoDetailRow } from "../src/lib/d1/todos";

describe("繰り返しTodo編集の候補指定初期値", () => {
  it("保存済みの第N曜日と最終曜日を別々の選択状態へ戻す", () => {
    const todo = {
      managed_item_id: null,
      recurrence_basis: "calendar",
      schedule_kind: "monthly_nth_weekday",
      schedule_specs: JSON.stringify([
        { dayOfWeek: 5, kind: "monthly_nth_weekday", weekOfMonth: 2 },
        { dayOfWeek: 5, kind: "monthly_nth_weekday", weekOfMonth: 4 },
        {
          dayOfWeek: 5,
          kind: "monthly_nth_weekday",
          weekLast: true,
          weekOfMonth: 5,
        },
      ]),
      title: "資源ごみを出す",
    } as TodoDetailRow;

    expect(recurringRuleValues(todo)).toMatchObject({
      scheduleDaysOfWeek: [5],
      scheduleWeekLast: true,
      scheduleWeeksOfMonth: [2, 4],
    });
  });

  // Issue #101: 年次の曜日方式は月も候補指定から戻す。
  it("毎年の第N曜日は月・曜日・出現位置を初期値へ戻す", () => {
    const todo = {
      managed_item_id: null,
      recurrence_basis: "calendar",
      schedule_kind: "yearly_nth_weekday",
      schedule_specs: JSON.stringify([
        { dayOfWeek: 4, kind: "yearly_nth_weekday", month: 11, weekOfMonth: 3 },
        {
          dayOfWeek: 4,
          kind: "yearly_nth_weekday",
          month: 11,
          weekLast: true,
          weekOfMonth: 5,
        },
      ]),
      title: "年末の大掃除",
    } as TodoDetailRow;

    expect(recurringRuleValues(todo)).toMatchObject({
      scheduleDaysOfWeek: [4],
      scheduleKind: "yearly_nth_weekday",
      scheduleMonth: 11,
      scheduleWeekLast: true,
      scheduleWeeksOfMonth: [3],
    });
  });
});
