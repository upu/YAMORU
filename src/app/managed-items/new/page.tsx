import Link from "next/link";

import { requireUser } from "../../../lib/auth/current-user";
import { getD1Context } from "../../../lib/d1/context";
import { loadAccountState } from "../../../lib/d1/households";
import {
  listHouseholdCustomItemTypes,
  listManagedItemClassificationOptions,
  type ManagedItemCustomTypeOption,
} from "../../../lib/d1/managed-items";
import { ManagedItemForm } from "../managed-item-form";
import type { ManagedItemClassificationOptions } from "../model";

type HouseholdSummary = { id: string; name: string };

export function ManagedItemRegistrationContent({
  classificationOptions,
  customItemTypeOptions,
  household,
  nowIso,
}: {
  classificationOptions: ManagedItemClassificationOptions;
  customItemTypeOptions?: ManagedItemCustomTypeOption[];
  household: HouseholdSummary | null;
  nowIso?: string;
}) {
  return (
    <main className="detail-page ledger-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/managed-items">← 家の台帳へ戻る</Link>
      </nav>

      <header className="detail-hero">
        <p className="detail-kicker">ADD ITEM</p>
        <h1>管理対象を登録</h1>
        <p>家で管理するものと、確認に使う外部リンクを登録します。</p>
      </header>

      {household === null ? (
        <section aria-labelledby="household-required-title" className="detail-card">
          <h2 id="household-required-title">家庭を作成してください</h2>
          <p>台帳は家庭ごとに保存します。先にアカウント画面で家庭を作成してください。</p>
          <Link className="ledger-primary-link" href="/account">
            家庭を作成する
          </Link>
        </section>
      ) : (
        <section aria-labelledby="register-item-title" className="detail-card">
          <h2 id="register-item-title">登録内容</h2>
          <p className="detail-note">{household.name}の台帳へ追加します。</p>
          <ManagedItemForm
            classificationOptions={classificationOptions}
            customItemTypeOptions={customItemTypeOptions}
            nowIso={nowIso}
          />
        </section>
      )}
    </main>
  );
}

export default async function ManagedItemRegistrationPage() {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const household: HouseholdSummary | null = (
    await loadAccountState(db, session)
  ).household;
  // Issue #288: 自由入力の詳しい種類の候補は家庭専用データなので、家庭に
  // 所属していない利用者では取得しない(台帳一覧と同じ扱い)。
  const [classificationOptions, customItemTypeOptions]: [
    ManagedItemClassificationOptions,
    ManagedItemCustomTypeOption[],
  ] = household === null
    ? [{ itemTypes: [], kinds: [] }, []]
    : await Promise.all([
      listManagedItemClassificationOptions(db),
      listHouseholdCustomItemTypes(db, session),
    ]);

  return (
    <ManagedItemRegistrationContent
      classificationOptions={classificationOptions}
      customItemTypeOptions={customItemTypeOptions}
      household={household}
      nowIso={new Date().toISOString()}
    />
  );
}
