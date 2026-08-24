import Link from "next/link";

import { requireUser } from "../../../lib/auth/current-user";
import { getD1Context } from "../../../lib/d1/context";
import { listManagedItems } from "../../../lib/d1/managed-items";
import { loadAccountState } from "../../../lib/d1/households";
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
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const household = (await loadAccountState(db, session)).household;
  if (household === null) {
    return (
      <TodoRegistrationContent
        household={null}
        initialManagedItemId={null}
        managedItems={[]}
      />
    );
  }

  const managedItems = (await listManagedItems(db, session)).sort((left, right) => left.name.localeCompare(right.name));

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
