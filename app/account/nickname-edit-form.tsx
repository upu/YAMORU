"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { updateNickname } from "./actions";
import { INITIAL_NICKNAME_EDIT_STATE, type NicknameEditActionState } from "./state";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      aria-disabled={pending}
      className="auth-submit"
      disabled={pending}
      type="submit"
    >
      {pending ? "保存中…" : "変更を保存"}
    </button>
  );
}

function NicknameDisplay({
  nickname,
  onEdit,
  state,
}: {
  nickname: string;
  onEdit: () => void;
  state: NicknameEditActionState;
}) {
  return (
    <div className="nickname-display">
      <p className="nickname-value">{nickname}</p>
      <button className="nickname-toggle-button" onClick={onEdit} type="button">
        編集
      </button>
      {state.status === "success" ? (
        <p className="auth-feedback todo-success" role="status">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function NicknameEditFields({
  formAction,
  nickname,
  onCancel,
  state,
}: {
  formAction: (formData: FormData) => void;
  nickname: string;
  onCancel: () => void;
  state: NicknameEditActionState;
}) {
  return (
    <form action={formAction} className="auth-form">
      <label htmlFor="nickname-edit">ニックネーム</label>
      <input
        aria-describedby="nickname-edit-help"
        autoComplete="nickname"
        defaultValue={nickname}
        id="nickname-edit"
        maxLength={20}
        name="nickname"
        required
        type="text"
      />
      <p id="nickname-edit-help">1文字以上20文字以内で入力してください。</p>
      <div className="nickname-edit-actions">
        <SubmitButton />
        <button className="nickname-toggle-button" onClick={onCancel} type="button">
          キャンセル
        </button>
      </div>
      {state.status === "error" ? (
        <p className="auth-feedback" role="alert">{state.message}</p>
      ) : null}
    </form>
  );
}

export function NicknameEditForm({ nickname }: { nickname: string }) {
  const [state, formAction] = useActionState(
    updateNickname,
    INITIAL_NICKNAME_EDIT_STATE,
  );
  const [isEditing, setIsEditing] = useState(false);

  // 保存に成功したら表示モードへ戻す。レンダー中にstateの変化を検知して
  // 調整する(Reactの「前の値と比較してstateを調整する」パターン)ことで、
  // 保存完了とキャンセルを取り違えないようにする(useEffectでのsetState連鎖を
  // 避ける)。親から渡されるnicknameもrevalidatePathによるルート再取得で
  // 新しい値に置き換わる。
  const [handledStatus, setHandledStatus] = useState(state.status);
  if (state.status !== handledStatus) {
    setHandledStatus(state.status);
    if (state.status === "success") setIsEditing(false);
  }

  if (!isEditing) {
    return (
      <NicknameDisplay
        nickname={nickname}
        onEdit={() => {
          setIsEditing(true);
        }}
        state={state}
      />
    );
  }

  return (
    <NicknameEditFields
      formAction={formAction}
      nickname={nickname}
      onCancel={() => {
        setIsEditing(false);
      }}
      state={state}
    />
  );
}
