// 同意画面で利用者が見た内容(接続元の名前と対象の家庭)と、送信時に解決し直した
// 内容を照らし合わせる。表示から送信までの間にCIMDが更新されたり、利用者の所属
// する家庭が変わったりした場合は、許可を受け付けず同意画面を表示し直す。比べる
// 相手はサーバーが解決した値なので、hiddenの値を書き換えても同意画面が出直す
// だけで、表示していない名前や家庭を記録させることはできない。
export const DISPLAYED_CLIENT_NAME_FIELD = "displayedClientName";
export const DISPLAYED_HOUSEHOLD_ID_FIELD = "displayedHouseholdId";

export type ConsentSnapshot = { clientName: string; householdId: string };

export function isSameConsentScreen(formData: FormData, current: ConsentSnapshot): boolean {
  return formData.get(DISPLAYED_CLIENT_NAME_FIELD) === current.clientName &&
    formData.get(DISPLAYED_HOUSEHOLD_ID_FIELD) === current.householdId;
}
