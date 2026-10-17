// 同意画面で利用者が見た接続元の名前と、送信時に解決し直した名前を照らし合わせる。
// 表示から送信までの間にCIMDが更新された場合は、許可を受け付けず同意画面を
// 表示し直す。比べる相手はサーバーが解決した値なので、hiddenの値を書き換えても
// 同意画面が出直すだけで、表示していない名前を記録させることはできない。
export const DISPLAYED_CLIENT_NAME_FIELD = "displayedClientName";

export function isSameConsentScreen(
  displayedClientName: FormDataEntryValue | null,
  client: { clientName: string },
): boolean {
  return displayedClientName === client.clientName;
}
