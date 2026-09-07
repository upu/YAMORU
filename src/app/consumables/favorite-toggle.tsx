"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  type ConsumableFavoriteActionState,
  updateConsumableFavorite,
} from "./favorite-actions";

const INITIAL_STATE: ConsumableFavoriteActionState = { message: "", status: "idle" };

function FavoriteButton({ isFavorite }: { isFavorite: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-pressed={isFavorite}
      className="favorite-toggle"
      disabled={pending}
      type="submit"
    >
      <span aria-hidden="true">{isFavorite ? "★" : "☆"}</span>
      {isFavorite ? "お気に入りから外す" : "お気に入りに追加"}
    </button>
  );
}

export function FavoriteToggle({
  consumableId,
  isFavorite,
}: {
  consumableId: string;
  isFavorite: boolean;
}) {
  const [state, formAction] = useActionState(updateConsumableFavorite, INITIAL_STATE);
  return (
    <div className="favorite-control">
      <form action={formAction}>
        <input name="id" type="hidden" value={consumableId} />
        <input name="favorite" type="hidden" value={String(!isFavorite)} />
        <FavoriteButton isFavorite={isFavorite} />
      </form>
      {state.status === "idle" ? null : (
        <p className="auth-feedback" role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      )}
    </div>
  );
}
