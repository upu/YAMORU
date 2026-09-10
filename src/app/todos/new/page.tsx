import Link from "next/link";

import { requireUser } from "../../../lib/auth/current-user";
import { getD1Context } from "../../../lib/d1/context";
import { listManagedItems } from "../../../lib/d1/managed-items";
import { loadAccountState } from "../../../lib/d1/households";
import { DetailBackNav, type DetailBackNavTarget } from "../../detail-back-nav";
import {
  TodoRegistrationForm,
  type TodoManagedItemOption,
} from "./todo-registration-form";

type HouseholdSummary = { id: string; name: string };

// Issue #327: この画面固有の戻る導線は、管理対象から来たときだけ置く。
// ホームへは共通ヘッダーと下部タブから移動できるため、Todoを追加する作業の
// 文脈を切る「ホームへ戻る」は出さない。戻り先はブラウザ履歴ではなく
// /managed-items/{id}へ固定し、直接URLを開いた場合や再読み込みでも変わらない
// ようにする(issue本文の理由)。
function managedItemBackNav(
  initialManagedItemId: string | null,
  managedItems: TodoManagedItemOption[],
): DetailBackNavTarget | null {
  if (initialManagedItemId === null) return null;
  const item = managedItems.find((candidate) => candidate.id === initialManagedItemId);
  if (item === undefined) return null;
  return {
    href: `/managed-items/${encodeURIComponent(item.id)}`,
    label: `${item.name}へ戻る`,
  };
}

export function TodoRegistrationContent({
  household,
  initialManagedItemId,
  managedItems,
}: {
  household: HouseholdSummary | null;
  initialManagedItemId: string | null;
  managedItems: TodoManagedItemOption[];
}) {
  const backNav = managedItemBackNav(initialManagedItemId, managedItems);
  return (
    <main className="detail-page todo-registration-page">
      {backNav === null ? null : <DetailBackNav {...backNav} />}
      {/* Issue #327: Todoを追加するだけの画面に「ADD TODO」「Todoを追加」
      説明文「登録内容」と役割の重なる見出しが4つ並び、フォームまでの縦幅を
      使っていた。小さめのページ見出し一つに寄せる。 */}
      <h1 className="form-page-title">Todoを追加</h1>

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
          {/* 「登録内容」はページ見出しと役割が重なるため画面には出さないが、
          入力領域の意味は支援技術向けに残す(Todo一覧の一覧領域と同じ扱い)。 */}
          <h2 className="sr-only" id="todo-form-title">登録内容</h2>
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
