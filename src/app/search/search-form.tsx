// Issue #350 / YDR-042: 横断検索の入力欄。検索語はURLクエリー(?q=)で持ち、
// サーバー側で結果を描く。戻る操作・再読み込み・URL共有で同じ結果になり、
// Todo一覧(#225)・台帳(#218)の画面内検索と同じ規則になる。入力のたびに
// 自動で検索せず、実行は明示操作(送信)とする。
// GETフォームだけで成り立つのでClient Componentにしない。
export function SearchForm({ q }: { q: string | undefined }) {
  return (
    <form
      action="/search"
      aria-label="YAMORU全体を検索"
      className="auth-form ledger-search-form"
      method="get"
      role="search"
    >
      <label className="sr-only" htmlFor="cross-search-q">名前で検索</label>
      <input
        defaultValue={q ?? ""}
        id="cross-search-q"
        name="q"
        placeholder="名前で検索"
        type="search"
      />
      <button type="submit">検索</button>
    </form>
  );
}
