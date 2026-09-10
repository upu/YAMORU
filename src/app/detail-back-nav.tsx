import Link from "next/link";

// Issue #391: 詳細画面の戻る導線を一つの部品へ寄せる。位置(ページの最上部)、
// 表現(「← ○○へ戻る」)、読み上げ名(ページ移動)を画面ごとに書き分けない。
// 戻り先はその詳細が属する一覧に固定する。どこから開いても同じ場所へ同じ
// 言葉で戻れることを優先し、直前の画面へ戻る操作はブラウザ/PWAの履歴に任せる。
// 戻り先が文脈依存になる登録・編集画面は、この規約の対象外として#327で扱う。

export type DetailBackNavTarget = { href: string; label: string };

// Todo詳細はTodo一覧以外(ホーム・管理対象詳細・横断検索)からも開くが、
// 画面ごとに戻る導線の有無が変わらないよう、Todo一覧を固定の戻り先とする
// (Issue #264で置かない判断をしていたが、#391で3画面の規約へそろえた)。
export const TODO_DETAIL_BACK_NAV: DetailBackNavTarget = {
  href: "/todos",
  label: "Todo一覧へ戻る",
};

// 備品・サービス・契約と消耗品は、URLとデータモデルは分けたまま(#291)、
// 家庭から見ればどちらも「家の台帳」の中にある。戻り先のカテゴリだけを
// 変え、言葉は同じにする。
export const MANAGED_ITEM_DETAIL_BACK_NAV: DetailBackNavTarget = {
  href: "/managed-items",
  label: "家の台帳へ戻る",
};

export const CONSUMABLE_DETAIL_BACK_NAV: DetailBackNavTarget = {
  href: "/consumables",
  label: "家の台帳へ戻る",
};

export function DetailBackNav({ href, label }: DetailBackNavTarget) {
  return (
    <nav aria-label="ページ移動" className="back-nav">
      <Link href={href}>← {label}</Link>
    </nav>
  );
}
