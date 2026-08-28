import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "../../../../lib/auth/current-user";
import { getD1Context } from "../../../../lib/d1/context";
import {
  getManagedItemForEdit,
  listManagedItemClassificationOptions,
} from "../../../../lib/d1/managed-items";
import { ManagedItemEditForm } from "./managed-item-edit-form";

// Issue #40: 自家庭のManagedItemの名前・種類・外部リンクを編集する専用画面。
// 閲覧(詳細画面)と編集を分ける(設計メモ)。
export default async function ManagedItemEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { db, session } = await getD1Context(user);
  const [item, classificationOptions] = await Promise.all([
    getManagedItemForEdit(db, session, id),
    listManagedItemClassificationOptions(db),
  ]);

  if (item === null) notFound();

  return (
    <main className="detail-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href={`/managed-items/${encodeURIComponent(id)}`}>
          ← 管理対象の詳細へ戻る
        </Link>
      </nav>

      <header className="detail-hero">
        <p className="detail-kicker">EDIT</p>
        <h1>{item.name}を編集</h1>
        <p>名前、種類、外部リンク、任意の記録を変更できます。</p>
      </header>

      <section aria-labelledby="managed-item-edit-title" className="detail-card">
        <h2 id="managed-item-edit-title">管理対象を編集</h2>
        <ManagedItemEditForm
          classificationOptions={classificationOptions}
          customItemType={item.customItemType}
          externalUrl={item.externalUrl}
          id={id}
          itemTypeCode={item.itemTypeCode}
          kindCode={item.kindCode}
          name={item.name}
          note={item.note}
          productInfo={item.productInfo}
          startedOn={item.startedOn}
        />
      </section>
    </main>
  );
}
