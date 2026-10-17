"use client";
import { useActionState, useRef } from "react";
type ActionState = { message: string; status: "idle" | "error" | "success" };
export function useStockAction(action: (previous: ActionState, form: FormData) => Promise<ActionState>, revision?: number) {
  const attempt = useRef<{ intent: string; id: string } | null>(null);
  return useActionState(async (previous: ActionState, form: FormData) => {
    const intent = JSON.stringify([Array.from(form.entries()), revision]);
    if (attempt.current?.intent !== intent) attempt.current = { intent, id: crypto.randomUUID() };
    form.set("operationId", attempt.current.id);
    if (revision !== undefined) form.set("stockRevision", String(revision));
    const result = await action(previous, form);
    if (result.status === "success") attempt.current = null;
    return result;
  }, { message: "", status: "idle" } as ActionState);
}
