// Todo操作のactionが共有する、RPCエラーの読み替え。
//
// RPCのエラーメッセージに含まれる断片から、利用者向けの案内文へ変換する。
// 各actionは断片と応答の対応表(先勝ち)をこの関数へ渡すだけでよく、
// if文の連なりを重複させない(完了・担当・延期・取消・訂正で同じ形の
// マッピングが必要になるため)。
//
// 複数のactionで同じ断片・同じ案内文を使うものだけをここへ置く。
// 一つのactionでしか使わない断片は、そのactionのファイルに置く。
import type { MaintenanceTodoActionState } from "../state";

type RpcErrorRule = { fragment: string; response: MaintenanceTodoActionState };

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

export function mapRpcError(
  message: string,
  rules: RpcErrorRule[],
  fallback: MaintenanceTodoActionState,
): MaintenanceTodoActionState {
  const matched = rules.find((rule) => message.includes(rule.fragment));
  return matched === undefined ? fallback : matched.response;
}

// 「他の操作で状態が変わりました」は、pending/completed限定のRPCが条件付き
// 更新に負けたときの共通の案内文。RPCごとに検知する断片文字列は異なるが
// (「is not pending」「is not completed」)、利用者への案内は同じにする。
export const STATE_CHANGED_ERROR: MaintenanceTodoActionState = {
  message: "他の操作で状態が変わりました。最新の状態を確認してください。",
  status: "error",
};

export const CONFLICT_MESSAGE_FRAGMENT = "is not pending";
export const NOT_COMPLETED_MESSAGE_FRAGMENT = "is not completed";
export const NEXT_OCCURRENCE_MODIFIED_MESSAGE_FRAGMENT = "Next occurrence has been modified";
export const PERFORMER_NOT_FOUND_MESSAGE_FRAGMENT = "Performer not found";
export const SCHEDULE_COLLISION_MESSAGE_FRAGMENT = "already exists for the computed schedule";

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
