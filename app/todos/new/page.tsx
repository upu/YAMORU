import Link from "next/link";

import { requireUser } from "../../../lib/auth/current-user";
import { createClient } from "../../../lib/supabase/server";
import {
  TodoRegistrationForm,
  type TodoManagedItemOption,
} from "./todo-registration-form";

type HouseholdSummary = { id: string; name: string };

export function TodoRegistrationContent({
  household,
  initialManagedItemId,
  managedItems,
}: {
  household: HouseholdSummary | null;
  initialManagedItemId: string | null;
  managedItems: TodoManagedItemOption[];
}) {
  return (
    <main className="detail-page todo-registration-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/">← ホームへ戻る</Link>
      </nav>
      <header className="detail-hero">
        <p className="detail-kicker">ADD TODO</p>
        <h1>Todoを追加</h1>
        <p>やることと繰り返し方を登録します。管理対象との関連付けは任意です。</p>
      </header>

      {household === null ? (
        <section aria-labelledby="household-required-title" className="detail-card">
          <h2 id="household-required-title">家庭を作成してください</h2>
          <p>Todoは家庭ごとに保存します。先にアカウント画面で家庭を作成してください。</p>
          <Link className="ledger-primary-link" href="/account">
            家庭を作成する
          </Link>
        </section>
      ) : (
        <section aria-labelledby="todo-form-title" className="detail-card todo-registration-card">
          <h2 id="todo-form-title">登録内容</h2>
          <p className="detail-note">{household.name}のTodoへ追加します。</p>
          <TodoRegistrationForm
            initialManagedItemId={initialManagedItemId}
            managedItems={managedItems}
          />
        </section>
      )}
    </main>
  );
}

export default async function TodoRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const supabase = await createClient();
  const { data: household, error: householdError } = await supabase
    .from("households")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (householdError !== null) {
    throw new Error("家庭情報を取得できませんでした。");
  }
  if (household === null) {
    return (
      <TodoRegistrationContent
        household={null}
        initialManagedItemId={null}
        managedItems={[]}
      />
    );
  }

  const { data: managedItems, error: managedItemsError } = await supabase
    .from("managed_items")
    .select("id, name")
    .eq("household_id", household.id)
    .order("name", { ascending: true });
  if (managedItemsError !== null) {
    throw new Error("Todoに関連付ける管理対象を取得できませんでした。");
  }

  const resolvedSearchParams = await searchParams;
  const requestedManagedItemId = resolvedSearchParams.managedItemId;
  const initialManagedItemId = typeof requestedManagedItemId === "string" &&
      managedItems.some((item) => item.id === requestedManagedItemId)
    ? requestedManagedItemId
    : null;

  return (
    <TodoRegistrationContent
      household={household}
      initialManagedItemId={initialManagedItemId}
      managedItems={managedItems}
    />
  );
}
