"use client";
import { useActionState } from "react";
import type { CandidateControl } from "../../../features/integration/notifications/contract";
import { candidateControlAction } from "./actions";
import { INITIAL_NOTIFICATION_STATE } from "./state";
export function CandidateControls({ candidateId, control, timeZone }: { candidateId: string; control: CandidateControl; timeZone: string }) {
  const [state, action, pending] = useActionState(candidateControlAction, INITIAL_NOTIFICATION_STATE);
  return <form action={action}>
    <input type="hidden" name="candidateId" value={candidateId} />
    {control.muted ? <p>この用事の通知を休止中</p> : null}
    {control.snoozedUntil ? <p><time dateTime={control.snoozedUntil}>{new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(control.snoozedUntil))}</time>まで通知を休止</p> : null}
    <button name="control" value="tomorrow" disabled={pending}>明日のまとめ時刻まで休む</button>{" "}
    <button name="control" value="mute" disabled={pending}>この用事の通知を休止</button>{" "}
    <button name="control" value="resume" disabled={pending}>休止を解除</button>
    {state.message ? <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
  </form>;
}
