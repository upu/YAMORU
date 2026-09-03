import { describe, expect, it } from "vitest";

import { recurringRuleValues } from "../src/app/todos/[id]/edit/recurring-todo-edit-values";
import { type TodoDetailRow } from "../src/lib/d1/todos";

describe("繰り返しTodo編集の月次候補初期値", () => {
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
});
