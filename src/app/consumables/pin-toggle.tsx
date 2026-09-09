"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { FirstRunHint, useFirstRunHint } from "../first-run-hint";
import { PinIcon } from "./pin-icon";
import {
  type ConsumablePinActionState,
  updateConsumablePin,
} from "./pin-actions";
import styles from "./pin-toggle.module.css";

const INITIAL_STATE: ConsumablePinActionState = { message: "", status: "idle" };

const HINT_ELEMENT_ID = "consumable-pin-hint";

/* Issue #361: 日常的に何度も使う操作なので、説明文を常時は出さずアイコンだけを
   置く。読み上げ用の語は.sr-onlyで残し、初めての利用者には初回ヒントで補う。 */
function PinButton({
  hintElementId,
  isPinned,
  onPress,
}: {
  hintElementId: string | undefined;
  isPinned: boolean;
  onPress: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-describedby={hintElementId}
      aria-pressed={isPinned}
      className={styles.toggle}
      disabled={pending}
      onClick={onPress}
      type="submit"
    >
      <PinIcon isPinned={isPinned} />
      <span className="sr-only">
        {isPinned ? "ピン留めを外す" : "ホームにピン留め"}
      </span>
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
  // 操作した時点で意味は伝わっているので、押したヒントも既読にする。
  const { dismiss, isVisible } = useFirstRunHint("consumable-pin");
  return (
    <div className={styles.control}>
      <form action={formAction}>
        <input name="id" type="hidden" value={consumableId} />
        <input name="pinned" type="hidden" value={String(!isPinned)} />
        <PinButton
          hintElementId={isVisible ? HINT_ELEMENT_ID : undefined}
          isPinned={isPinned}
          onPress={dismiss}
        />
      </form>
      {isVisible ? (
        <FirstRunHint id={HINT_ELEMENT_ID} onDismiss={dismiss}>
          よく使う消耗品をピン留めすると、ホームからすぐ確認・操作できます。
        </FirstRunHint>
      ) : null}
      {state.status === "idle" ? null : (
        <p className="auth-feedback" role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      )}
    </div>
  );
}
