"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  type ConsumablePinActionState,
  updateConsumablePin,
} from "./pin-actions";

const INITIAL_STATE: ConsumablePinActionState = { message: "", status: "idle" };

function PinIcon({ isPinned }: { isPinned: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M8 3h8l-1 6 3 3v2h-5v7l-1 1-1-1v-7H6v-2l3-3Z" fill={isPinned ? "currentColor" : "none"} />
    </svg>
  );
}

function PinButton({ isPinned }: { isPinned: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-pressed={isPinned}
      className="pin-toggle"
      disabled={pending}
      type="submit"
    >
      <PinIcon isPinned={isPinned} />
      {isPinned ? "ピン留めを外す" : "ホームにピン留め"}
    </button>
  );
}

export function PinToggle({
  consumableId,
  isPinned,
}: {
  consumableId: string;
  isPinned: boolean;
}) {
  const [state, formAction] = useActionState(updateConsumablePin, INITIAL_STATE);
  return (
    <div className="pin-control">
      <form action={formAction}>
        <input name="id" type="hidden" value={consumableId} />
        <input name="pinned" type="hidden" value={String(!isPinned)} />
        <PinButton isPinned={isPinned} />
      </form>
      {state.status === "idle" ? null : (
        <p className="auth-feedback" role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      )}
    </div>
  );
}
