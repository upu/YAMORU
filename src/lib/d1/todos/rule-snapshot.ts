// Issue #265 / YDR-039: Occurrenceが発生した時点のTaskRuleをJSONへ固定する。
// migration、初回作成、次回生成、ルール編集で同じキーを使い、詳細・履歴の
// 読み取りが後からのTaskRule変更に引きずられないようにする。

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
    'intervalAnchorOn', ${ruleAlias}.interval_anchor_on
  )`;
}
