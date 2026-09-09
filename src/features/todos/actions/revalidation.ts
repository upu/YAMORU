import { revalidatePath } from "next/cache";

// Todoの状態を表示する画面(ManagedItem詳細・ホーム、Issue #36、Todo一覧、
// Issue #201、Todo詳細、Issue #203・#205、横断検索、Issue #350)をまとめて
// 再検証する。完了・担当変更・延期・予定日変更・完了取消・実施記録の訂正は
// いずれも同じ画面群へ反映されるため、同じ組を呼ぶ。
export function revalidateTodoViews(
  managedItemId: string | null,
  occurrenceId: string,
): void {
  if (managedItemId !== null) {
    revalidatePath(`/managed-items/${encodeURIComponent(managedItemId)}`);
  }
  revalidatePath("/");
  revalidatePath("/todos");
  revalidatePath(`/todos/${encodeURIComponent(occurrenceId)}`);
  revalidatePath("/search");
}
