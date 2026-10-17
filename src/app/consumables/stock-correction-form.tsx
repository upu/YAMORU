"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import type { StockRecord } from "../../lib/d1/consumable-stock-read";
import type { HouseholdMemberOption } from "../../lib/d1/profiles";
import { correctStockHistory } from "./history-actions";
import { useStockAction } from "./use-stock-action";
export function StockStatusOptions() { return <><option value="available">ある</option><option value="low">少ない</option><option value="out">ない</option></>; }
function SaveButton() { const { pending } = useFormStatus(); return <button className="button" disabled={pending}>{pending ? "保存中…" : "訂正を保存"}</button>; }
function performerDefault(record: StockRecord, members: HouseholdMemberOption[]) { return members.some((m) => m.userId === record.performerId) ? record.performerId ?? "" : ""; }
export function StockCorrectionForm({ record, consumableId, stockRevision, members }: { record: StockRecord; consumableId: string; stockRevision: number; members: HouseholdMemberOption[] }) {
  const [change, setChange] = useState("date");
  const [state, action] = useStockAction(correctStockHistory, stockRevision);
  return <details><summary>この記録を訂正・取消する</summary><p>元の記録は残ります。取消した記録も、訂正して有効に戻せます。</p>
    <form action={action} className="auth-form">
      <input type="hidden" name="id" value={consumableId} /><input type="hidden" name="recordId" value={record.recordId} /><input type="hidden" name="recordRevision" value={record.revision} />
      <label>訂正する項目<select name="change" value={change} onChange={(e) => { setChange(e.target.value); }}>
        <option value="date">実施日</option>{record.kind === "observation" ? <option value="status">在庫状態</option> : null}<option value="performer">実施者</option>{!record.voided ? <option value="void">記録を取消す</option> : null}
      </select></label>
      {change === "date" ? <label>正しい実施日<input name="on" type="date" required defaultValue={record.occurredOn ?? ""} /></label> : null}
      {change === "status" ? <label>正しい在庫状態<select name="status" defaultValue={record.status}><StockStatusOptions /></select></label> : null}
      {change === "performer" ? <label>実施者<select name="performerId" defaultValue={performerDefault(record, members)}><option value="">不明</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.nickname}</option>)}</select></label> : null}
      {change === "void" ? <p>この記録を現在状態の根拠から外します。</p> : null}
      <label>現在の在庫も確認した場合<select name="currentStatus" defaultValue=""><option value="">現在の観測は追加しない</option><StockStatusOptions /></select></label>
      <p className="input-help">訂正後の記録だけで現在状態を決められない場合は、今の在庫を選んでください。現在の観測も一緒に記録します。</p><SaveButton />
      {state.status !== "idle" ? <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form></details>;
}
