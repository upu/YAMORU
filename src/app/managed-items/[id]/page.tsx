import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "../../../lib/auth/current-user";
import {
  FALLBACK_OTHER_MEMBER_NAME,
  FALLBACK_SELF_ACTOR_NAME,
  type HouseholdMemberOption,
  loadActorName,
  loadHouseholdMembers,
  loadProfileNames,
} from "../../../lib/d1/profiles";
import { getD1Context } from "../../../lib/d1/context";
import { loadManagedItemDetail } from "../../../lib/d1/managed-items";
import {
  isSafeExternalUrl,
} from "../model";
import {
  buildPendingTodos,
  buildRecentCompletions,
  type ExternalLinkData,
  type PendingTodoData,
  type RecentCompletionData,
} from "./detail-todos";
import {
  ManagedItemHeader,
  ManagedItemRecordSection,
  RecentCompletionSection,
  RelatedTodoSection,
} from "./detail-sections";

export type ManagedItemDetailData = {
  actorName: string;
  currentUserId: string;
  externalLinks: ExternalLinkData[];
  id: string;
  itemTypeLabel: string | null;
  kindCode: string;
  kindLabel: string;
  members: HouseholdMemberOption[];
  name: string;
  note: string | null;
  pendingTodos: PendingTodoData[];
  productInfo: string | null;
  recentCompletions: RecentCompletionData[];
  startedOn: string | null;
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

      <ManagedItemHeader
        itemTypeLabel={item.itemTypeLabel}
        kindLabel={item.kindLabel}
        name={item.name}
      />

      <div className="ledger-grid managed-item-detail-grid">
        <ManagedItemRecordSection
          kindCode={item.kindCode}
          managedItemId={item.id}
          note={item.note}
          productInfo={item.productInfo}
          safeLinks={safeLinks}
          startedOn={item.startedOn}
        />

        <RelatedTodoSection
          actorName={item.actorName}
          currentUserId={item.currentUserId}
          managedItemId={item.id}
          members={item.members}
          todos={item.pendingTodos}
        />

        <RecentCompletionSection
          completions={item.recentCompletions}
        />
      </div>
    </main>
  );
}

export default async function RegisteredManagedItemDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { db, session } = await getD1Context(user);
  const nowIso = new Date().toISOString();
  const [data, actorName] = await Promise.all([
    loadManagedItemDetail(db, session, id),
    loadActorName(db, session, user.id, FALLBACK_SELF_ACTOR_NAME),
  ]);

  if (data === null) notFound();

  const pendingTodos = buildPendingTodos(data.task_rules, nowIso);
  const recentCompletionDrafts = buildRecentCompletions(data.task_rules);
  // Issue #240: 表示する完了記録に必要な家庭メンバーだけを安全に解決する
  // (loadProfileNamesは自家庭の範囲で絞り込む)。最新1件専用の取得処理
  // (旧LAST ACTIVITY)は不要になったため削除した。
  const performerIds = [
    ...new Set(recentCompletionDrafts.map((completion) => completion.performedByUserId)),
  ].filter((userId): userId is string => userId !== null);
  const [performerNames, members] = await Promise.all([
    loadProfileNames(db, session, performerIds),
    // Issue #72: 担当者選択の候補は同じ家庭のメンバーに限る。実施者選択(Issue #18)も同じ候補を使う。
    loadHouseholdMembers(db, session),
  ]);
  const recentCompletions: RecentCompletionData[] = recentCompletionDrafts.map(
    (completion) => ({
      id: completion.id,
      occurredAt: completion.occurredAt,
      // performed_by_user_idはaction='completed'の行にのみ設定される
      // (CHECK制約、YDR-020)。万一nullの場合もフォールバック名で表示する
      // (表示方針を画面間でそろえる)。
      performerName: (completion.performedByUserId === null
        ? null
        : performerNames.get(completion.performedByUserId)) ?? FALLBACK_OTHER_MEMBER_NAME,
      title: completion.title,
    }),
  );

  return (
    <ManagedItemDetailContent
      item={{
        actorName,
        currentUserId: user.id,
        externalLinks: data.external_links,
        id: data.id,
        itemTypeLabel: data.itemTypeLabel,
        kindCode: data.kindCode,
        kindLabel: data.kindLabel,
        members,
        name: data.name,
        note: data.note,
        pendingTodos,
        productInfo: data.productInfo,
        recentCompletions,
        startedOn: data.startedOn,
      }}
    />
  );
}
