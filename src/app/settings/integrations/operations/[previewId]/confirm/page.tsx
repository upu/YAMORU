import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "../../../../../../lib/auth/current-user";
import { getD1Context } from "../../../../../../lib/d1/context";
import { loadConfirmation } from "../../../../../../lib/d1/integration-confirmations";
import type { IntegrationOperation } from "../../../../../../lib/d1/integration-operations";
import { ConfirmationActions } from "./confirmation-actions";
import styles from "./confirm.module.css";
import { PreviewDetails } from "./preview-details";

// 外部commandの追加確認(#437、YDR-062)。会話で確認した後に家庭の内容が変わり、
// 作り直した変更の内容が前に確認したものと違うとき、本人がここで承認・拒否する。
// 開いただけでは何も変えない。本人・現在の家庭の確認必須の操作だけを表示し、
// それ以外は存在を明かさず404にする。

const COMMAND_LABELS: Record<string, string> = {
  "managed_item.create": "管理対象の登録",
  "managed_item.update": "管理対象の編集",
  "managed_item_with_todo.create": "管理対象とTodoの登録",
  "notification.configure": "通知設定の変更",
  "notification.snooze": "通知の一時停止",
  "stock.correct": "在庫記録の訂正",
  "stock.observe": "在庫の記録",
  "stock.refill": "補充の記録",
  "todo.complete": "Todoの完了",
  "todo.correct": "完了記録の訂正",
  "todo.create": "Todoの登録",
  "todo.reschedule": "Todoの延期",
  "todo.undo": "完了の取消",
  "todo.update": "Todoの編集",
};

type PageState = "approved" | "closed" | "denied" | "expired" | "pending" | "stale" | "succeeded";

function pageState(operation: IntegrationOperation, now: string): PageState {
  if (operation.status === "succeeded") return "succeeded";
  if (operation.confirmationStatus === "denied") return "denied";
  if (operation.status === "rejected" && operation.reasonCode === "stale_preview") return "stale";
  if (operation.status !== "prepared") return "closed";
  if (operation.expiresAt <= now) return "expired";
  return operation.confirmationStatus === "approved" ? "approved" : "pending";
}

const STATE_MESSAGES: Record<Exclude<PageState, "pending">, string> = {
  approved: "承認済みです。元の会話に戻って、操作を続けるよう伝えてください。",
  closed: "この変更は確認できない状態です。元の会話で状況を確かめてください。",
  denied: "この変更は取りやめました。",
  expired: "確認の期限が切れました。元の会話で、もう一度内容を確かめてから操作し直してください。",
  stale: "確認している間に家庭の内容が変わりました。元の会話で作り直してください。",
  succeeded: "この変更は実行済みです。",
};

export default async function ConfirmOperationPage({ params }: { params: Promise<{ previewId: string }> }) {
  const user = await requireUser();
  const { previewId } = await params;
  const { db, session } = await getD1Context(user);
  const view = await loadConfirmation(db, session, previewId);
  if (view === null) notFound();
  const { operation } = view;
  const state = pageState(operation, new Date().toISOString());
  return (
    <main className="page-form account-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/settings/integrations">← 外部サービスとの連携へ戻る</Link>
      </nav>
      <header className="detail-hero">
        <p className="detail-kicker">CONFIRM</p>
        <h1>外部サービスからの変更の確認</h1>
        <p>
          {view.clientName}から「{COMMAND_LABELS[operation.command] ?? operation.command}」の依頼があります。
          会話で確認した後に家庭の内容が変わり、変更の内容が前に確認したものと変わりました。内容を確かめて、承認するか取りやめてください。
        </p>
      </header>
      <section aria-labelledby="compare-title" className="detail-card">
        <h2 id="compare-title">変わった内容</h2>
        <div className={styles.compare}>
          <div>
            <h3>前に確認した内容</h3>
            {view.baselinePreview === null ? <p>前の内容は残っていません。</p> : <PreviewDetails preview={view.baselinePreview} />}
          </div>
          <div>
            <h3>今回の内容</h3>
            <PreviewDetails preview={operation.preview} />
          </div>
        </div>
      </section>
      <section aria-labelledby="decision-title" className="detail-card">
        <h2 id="decision-title">確認</h2>
        <p>期限: {new Date(operation.expiresAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</p>
        {state === "pending"
          ? <ConfirmationActions previewId={operation.previewId} />
          : <p role="status">{STATE_MESSAGES[state]}</p>}
      </section>
    </main>
  );
}
