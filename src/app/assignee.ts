// 担当者の表示に関する共有定義。担当を選ぶ画面(ホーム・ManagedItem詳細の
// AssigneePanel、Todo編集フォーム)と、担当を読むだけの画面(Todo詳細)が
// 同じ文言・同じ候補の形を使う。
//
// 「誰でも可」は担当者未設定の既定表示(YDR-006)。担当・実施・操作主体の
// いずれとも異なるラベルにする(YDR-020「UIでの区別」)。
export const UNASSIGNED_LABEL = "誰でも可";

export type AssigneeOption = { nickname: string; userId: string };
