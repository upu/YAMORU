import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "../../../../lib/auth/current-user";
import { getConsumable } from "../../../../lib/d1/consumables";
import { getD1Context } from "../../../../lib/d1/context";
import { ConsumableForm } from "../../consumable-form";

export default async function ConsumableEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { db, session } = await getD1Context(user);
  const consumable = await getConsumable(db, session, id);
  if (consumable === null) notFound();

  return (
    <main className="detail-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href={`/consumables/${encodeURIComponent(id)}`}>← 消耗品の詳細へ戻る</Link>
      </nav>
      <header className="detail-hero">
        <p className="detail-kicker">EDIT CONSUMABLE</p>
        <h1>{consumable.name}を編集</h1>
      </header>
      <section aria-labelledby="edit-consumable-title" className="detail-card">
        <h2 id="edit-consumable-title">消耗品を編集</h2>
        <ConsumableForm consumable={consumable} mode="edit" />
      </section>
    </main>
  );
}
