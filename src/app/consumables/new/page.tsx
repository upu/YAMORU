import Link from "next/link";

import { requireUser } from "../../../lib/auth/current-user";
import type { D1Session } from "../../../lib/d1/authorization";
import type { ConsumableRelationOption } from "../../../lib/d1/consumables";
import { getD1Context } from "../../../lib/d1/context";
import { loadAccountState } from "../../../lib/d1/households";
import { getManagedItem } from "../../../lib/d1/managed-items";
import { ConsumableForm } from "../consumable-form";

// Issue #292: 消耗品フォームは候補を全件受け取らなくなったため、管理対象詳細
// から引き継ぐ1件だけをここで解決する。家庭の外のIDを渡されてもgetManagedItem
// がhousehold_idで絞り込むため、初期選択にはならない。
async function loadInitialManagedItem(
  db: D1Database,
  session: D1Session,
  rawManagedItemId: string | string[] | undefined,
): Promise<ConsumableRelationOption | undefined> {
  if (typeof rawManagedItemId !== "string" || rawManagedItemId === "") return undefined;
  const item = await getManagedItem(db, session, rawManagedItemId);
  return item === null ? undefined : { id: item.id, name: item.name };
}

// Issue #393: 画面の組み立てだけを取り出し、家庭の有無ごとの見出しと入力欄を
// D1なしでテストできるようにする(管理対象登録・Todo追加と同じ形)。
export function ConsumableRegistrationContent({
  hasHousehold,
  initialManagedItem,
}: {
  hasHousehold: boolean;
  initialManagedItem?: ConsumableRelationOption;
}) {
  return (
    <main className="detail-page ledger-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/consumables">← 消耗品一覧へ戻る</Link>
      </nav>
      {/* Issue #393: キッカー・大見出し・「登録内容」と役割の重なる見出しを
      並べず、Todo追加画面(#327)と同じ小さめのページ見出し一つへ寄せる。 */}
      <h1 className="form-page-title">消耗品を登録</h1>
      {hasHousehold ? (
        <section aria-labelledby="register-consumable-title" className="detail-card">
          {/* 「登録内容」は画面には出さず、入力領域の意味だけを支援技術向けに
          残す(Todo追加画面と同じ扱い)。 */}
          <h2 className="sr-only" id="register-consumable-title">登録内容</h2>
          <ConsumableForm initialManagedItem={initialManagedItem} mode="create" />
        </section>
      ) : (
        <section aria-labelledby="household-required-title" className="detail-card">
          <h2 id="household-required-title">家庭を作成してください</h2>
          <p>消耗品は家庭ごとに保存します。</p>
          <Link className="ledger-primary-link" href="/account">家庭を作成する</Link>
        </section>
      )}
    </main>
  );
}

export default async function ConsumableRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const accountState = await loadAccountState(db, session);
  const initialManagedItem = accountState.household === null
    ? undefined
    : await loadInitialManagedItem(db, session, (await searchParams).managedItemId);

  return (
    <ConsumableRegistrationContent
      hasHousehold={accountState.household !== null}
      initialManagedItem={initialManagedItem}
    />
  );
}
