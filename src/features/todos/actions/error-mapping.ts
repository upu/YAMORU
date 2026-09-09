// Todo操作のactionが共有する、D1エラーの読み替え。
//
// D1層が投げる業務エラーの識別コード(`src/lib/d1/errors.ts`のD1ErrorCode)から
// 利用者向けの案内文へ変換する。各actionはコードと応答の対応表をこの関数へ
// 渡すだけでよく、if文の連なりを重複させない(完了・担当・延期・取消・訂正で
// 同じ形のマッピングが必要になるため)。
//
// コードを持たないエラー(不変条件違反、想定外の失敗)はfallbackへ落とし、
// 内部の詳細は表示しない。内部の英文メッセージは判定に使わないので、
// D1層の文言を変えても利用者向けの案内は変わらない(Issue #369)。
//
// 複数のactionで同じコード・同じ案内文を使うものだけをここへ置く。
// 一つのactionでしか使わない案内は、そのactionのファイルに置く。
import { type D1ErrorCode, d1ErrorCode } from "../../../lib/d1/errors";
import type { MaintenanceTodoActionState } from "../state";

export type TodoErrorResponses = Partial<Record<D1ErrorCode, MaintenanceTodoActionState>>;

export function mapTodoError(
  error: unknown,
  responses: TodoErrorResponses,
  fallback: MaintenanceTodoActionState,
): MaintenanceTodoActionState {
  const code = d1ErrorCode(error);
  return (code === undefined ? undefined : responses[code]) ?? fallback;
}

// 「他の操作で状態が変わりました」は、pending/completed限定の操作が条件付き
// 更新に負けたときの共通の案内文。検知するコードは操作ごとに異なるが
// (OCCURRENCE_NOT_PENDING / OCCURRENCE_NOT_COMPLETED)、利用者への案内は
// 同じにする。
export const STATE_CHANGED_ERROR: MaintenanceTodoActionState = {
  message: "他の操作で状態が変わりました。最新の状態を確認してください。",
  status: "error",
};

// 完了記録と実施日時の訂正は、どちらも実施日から次回予定を組み立て直すため
// 同じ2つの入力エラーを返す。
export const INVALID_OCCURRED_ON: MaintenanceTodoActionState = {
  message: "実施日を正しく入力してください。",
  status: "error",
};

export const SCHEDULE_COLLISION_ERROR: MaintenanceTodoActionState = {
  message: "その実施日では次回の予定が既存のTodoと重なります。別の日付を指定してください。",
  status: "error",
};

export const PERFORMER_NOT_FOUND_ERROR: MaintenanceTodoActionState = {
  message: "実施した人を指定できませんでした。同じ家庭のメンバーから選び直してください。",
  status: "error",
};

// 担当者は完了・訂正の実施者と別概念(YDR-020)で、案内文も分ける。
export const ASSIGNEE_NOT_FOUND_ERROR: MaintenanceTodoActionState = {
  message: "担当者を指定できませんでした。同じ家庭のメンバーから選び直してください。",
  status: "error",
};
