// Issue #265 / YDR-039: Occurrenceが発生した時点のTaskRuleをJSONへ固定する。
// migration、初回作成、次回生成、ルール編集で同じキーを使い、詳細・履歴の
// 読み取りが後からのTaskRule変更に引きずられないようにする。

// Issue #102 / YDR-040: 候補指定は複数件になりうるため、スナップショットへは
// 配列として畳んで残す。候補指定を持たない方式では空配列になる。
//
// 並び順は暦上の昇順で固定する(YDR-040の7・10)。行の取得順に任せると、同じ
// 候補指定でもJSON文字列が揺れ、updateRecurringTaskRuleの
// `o.rule_snapshot <> <新しいsnapshot>`が実質的な変更なしでも真になり、
// 変更履歴が作られてしまう。並び順はparseCalendarScheduleSpecsの
// compareStoredCalendarSpecsと同じキー順にそろえる。
export const CALENDAR_SCHEDULE_SPEC_ORDER =
  "s.month, s.day_of_month, s.week_of_month, s.week_last, s.day_of_week";

export function calendarScheduleSpecsExpression(ruleAlias = "r"): string {
  return `(SELECT json_group_array(json_object(
    'kind', s.schedule_kind,
    'dayOfWeek', s.day_of_week,
    'weekOfMonth', s.week_of_month,
    'weekLast', s.week_last,
    'dayOfMonth', s.day_of_month,
    'monthEnd', s.month_end,
    'month', s.month
  ) ORDER BY ${CALENDAR_SCHEDULE_SPEC_ORDER})
    FROM task_rule_schedules s
   WHERE s.task_rule_id = ${ruleAlias}.id
     AND s.household_id = ${ruleAlias}.household_id)`;
}

export function taskRuleSnapshotExpression(
  ruleAlias = "r",
  managedItemAlias = "i",
): string {
  return `json_object(
    'title', ${ruleAlias}.title,
    'managedItemId', ${ruleAlias}.managed_item_id,
    'managedItemName', ${managedItemAlias}.name,
    'recurrenceBasis', ${ruleAlias}.recurrence_basis,
    'deadlineKind', ${ruleAlias}.deadline_kind,
    'recommendedStartOffset', ${ruleAlias}.recommended_start_offset,
    'recommendedUntilOffset', ${ruleAlias}.recommended_until_offset,
    'recommendedStartValue', ${ruleAlias}.recommended_start_value,
    'recommendedUntilValue', ${ruleAlias}.recommended_until_value,
    'recommendedUnit', ${ruleAlias}.recommended_unit,
    'scheduleKind', ${ruleAlias}.schedule_kind,
    'scheduleDayOfWeek', ${ruleAlias}.schedule_day_of_week,
    'scheduleDayOfMonth', ${ruleAlias}.schedule_day_of_month,
    'scheduleWeekOfMonth', ${ruleAlias}.schedule_week_of_month,
    'scheduleMonth', ${ruleAlias}.schedule_month,
    'scheduleMonthEnd', ${ruleAlias}.schedule_month_end,
    'intervalUnit', ${ruleAlias}.interval_unit,
    'intervalCount', ${ruleAlias}.interval_count,
    'intervalAnchorOn', ${ruleAlias}.interval_anchor_on,
    'scheduleSpecs', ${calendarScheduleSpecsExpression(ruleAlias)}
  )`;
}
