import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "../../../lib/auth/current-user";
import { createClient } from "../../../lib/supabase/server";
import {
  isSafeExternalUrl,
  MANAGED_ITEM_KIND_LABELS,
  type ManagedItemKind,
} from "../model";

type ExternalLinkData = { id: string; url: string };

export type ManagedItemDetailData = {
  externalLinks: ExternalLinkData[];
  id: string;
  kind: ManagedItemKind;
  name: string;
};

export function ManagedItemDetailContent({
  item,
}: {
  item: ManagedItemDetailData;
}) {
  const safeLinks = item.externalLinks.filter((link) =>
    isSafeExternalUrl(link.url),
  );

  return (
    <main className="detail-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/managed-items">← 家の台帳へ戻る</Link>
      </nav>

      <header className="detail-hero">
        <p className="detail-kicker">MANAGED ITEM</p>
        <div className="detail-title-row">
          <h1>{item.name}</h1>
          <span className="kind-badge">
            {MANAGED_ITEM_KIND_LABELS[item.kind]}
          </span>
        </div>
        <p>登録した管理対象の種類と外部リンクを確認できます。</p>
      </header>

      <section aria-labelledby="external-links-title" className="detail-card">
        <p className="detail-kicker">REFERENCES</p>
        <h2 id="external-links-title">外部リンク</h2>
        {safeLinks.length === 0 ? (
          <p className="ledger-empty">外部リンクは登録されていません。</p>
        ) : (
          <ul className="external-link-list">
            {safeLinks.map((link) => (
              <li key={link.id}>
                <a
                  href={link.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  外部リンクを開く: {link.url}
                  <span aria-hidden="true"> ↗</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default async function RegisteredManagedItemDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("managed_items")
    .select("id, name, kind, external_links(id, url)")
    .eq("id", id)
    .maybeSingle();

  if (error !== null) {
    throw new Error("管理対象を取得できませんでした。");
  }

  if (data === null) notFound();

  const row = data as {
    external_links: ExternalLinkData[] | null;
    id: string;
    kind: ManagedItemKind;
    name: string;
  };

  return (
    <ManagedItemDetailContent
      item={{
        externalLinks: row.external_links ?? [],
        id: row.id,
        kind: row.kind,
        name: row.name,
      }}
    />
  );
}
