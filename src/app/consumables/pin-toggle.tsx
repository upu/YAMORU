"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  type ConsumablePinActionState,
  updateConsumablePin,
} from "./pin-actions";

const INITIAL_STATE: ConsumablePinActionState = { message: "", status: "idle" };

function FavoriteButton({ isPinned }: { isPinned: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-pressed={isPinned}
      className="pin-toggle"
      disabled={pending}
      type="submit"
    >
      <span aria-hidden="true">{isPinned ? "★" : "☆"}</span>
      {isPinned ? "お気に入りから外す" : "お気に入りに追加"}
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
        <input name="favorite" type="hidden" value={String(!isPinned)} />
        <FavoriteButton isPinned={isPinned} />
      </form>
      {state.status === "idle" ? null : (
        <p className="auth-feedback" role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      )}
    </div>
  );
}
