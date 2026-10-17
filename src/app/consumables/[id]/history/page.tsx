import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "../../../../lib/auth/current-user";
import { getD1Context } from "../../../../lib/d1/context";
import { listStockHistory, listStockVersions, loadStockState, stockOwner, type StockHistoryItem, type StockVersion } from "../../../../lib/d1/consumable-stock-read";
import { loadHouseholdMembers } from "../../../../lib/d1/profiles";
import { StockCorrectionForm } from "../../stock-correction-form";
import { stockStatusLabel } from "../../stock-status";
import { stockOccurredLabel, stockRecordedLabel, stockSourceLabel } from "../../stock-history-labels";
import styles from "../../stock-history.module.css";
import { DetailBackNav } from "../../../detail-back-nav";
function VersionItem({ version: v }: { version: StockVersion }) {
  const action = { created: "原記録", voided: "取消", corrected: "訂正" }[v.action];
  return <li><p>{action}（版{v.revision}）: {stockOccurredLabel(v.occurredOn, v.occurredAt)} / {stockStatusLabel(v.status)}</p>
    <p>実施者: {v.performerName ?? "不明"} / 記録者: {v.actorName ?? "不明"}</p><p>記録日時: {stockRecordedLabel(v.recordedAt)} / {stockSourceLabel(v.source, v.clientId)}</p></li>;
}
function HistoryItem({ record: r, base }: { record: StockHistoryItem; base: string }) {
  const label = r.kind === "state_snapshot" ? "保存済み状態（観測日不明）" : `${r.kind === "refill" ? "補充" : "在庫の観測"}: ${stockOccurredLabel(r.occurredOn, r.occurredAt)}`;
  return <li><p>{label} / {stockStatusLabel(r.status)}{r.voided ? "（取消済み）" : ""}</p>
    <p>実施者: {r.performerName ?? "不明"} / 原記録者: {r.actorName ?? "不明"} / {stockSourceLabel(r.originalSource, r.originalClientId)}</p>
    <p>原記録日時: {stockRecordedLabel(r.createdAt)}</p>
    {r.revision > 0 ? <p>訂正あり（版{r.revision}） / 訂正者: {r.latestActorName ?? "不明"}</p> : null}
    <Link href={`${base}?record=${encodeURIComponent(r.recordId)}`}>記録と訂正履歴を開く</Link></li>;
}
async function versionsContent({ db, session, id, recordId, before, name, revision }: { db: D1Database; session: { userId: string }; id: string; recordId: string; before?: number; name: string; revision: number }) {
  const versions = await listStockVersions(db, session, id, recordId, before).catch(() => null);
  if (!versions) notFound();
  const members = await loadHouseholdMembers(db, session);
  const base = `/consumables/${encodeURIComponent(id)}/history`;
  return <main className="page-detail"><DetailBackNav href={base} label="在庫・補充の履歴へ戻る" /><header className="detail-hero"><h1>{name}の訂正履歴</h1></header><section className="detail-card">
    <ol className={styles.history}>{versions.items.map((v) => <VersionItem key={v.id} version={v} />)}</ol>
    {versions.nextBefore ? <Link href={`${base}?record=${encodeURIComponent(recordId)}&before=${String(versions.nextBefore)}`}>以前の版</Link> : null}
    {versions.record.kind !== "state_snapshot" ? <StockCorrectionForm key={`${versions.record.recordId}:${String(versions.record.revision)}`} record={versions.record} consumableId={id} stockRevision={revision} members={members} />
      : <p>保存済み状態のため実際の観測日は不明です。現在の在庫は消耗品の詳細で確認できます。</p>}
  </section></main>;
}
export default async function StockHistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ before?: string; record?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const { db, session } = await getD1Context(user);
  const state = await loadStockState(db, await stockOwner(db, session), id).catch(() => null);
  if (!state) notFound();
  const before = query.before === undefined ? undefined : Number(query.before);
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) notFound();
  if (query.record) return versionsContent({ db, session: { userId: user.id }, id, recordId: query.record, before, name: state.name, revision: state.revision });
  const base = `/consumables/${encodeURIComponent(id)}/history`;
  const page = await listStockHistory(db, session, id, { before });
  return <main className="page-detail"><DetailBackNav href={`/consumables/${encodeURIComponent(id)}`} label="消耗品の詳細へ戻る" /><header className="detail-hero"><h1>{state.name}の在庫・補充履歴</h1>
    <p>現在: {stockStatusLabel(state.status)}。観測は補充とは別の記録です。</p></header><section className="detail-card"><ul className={styles.history}>{page.items.map((r) => <HistoryItem key={r.recordId} record={r} base={base} />)}</ul>
      {page.nextBefore ? <Link href={`${base}?before=${String(page.nextBefore)}`}>以前の記録</Link> : null}</section></main>;
}
