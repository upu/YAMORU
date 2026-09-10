import Link from "next/link";

// Issue #391: 一覧の追加導線を、Todo・台帳(備品・サービス・契約)・消耗品で
// 同じ表現・同じ位置(一覧の操作行の先頭)に置く。行き先と文言の対を一つの型で
// 持ち、見出しの中のリンクと右下のフローティングボタン(floating-add-button)へ
// 同じ値を渡す。どちらの幅で見ても同じ言葉になり、「備品を登録」と
// 「台帳に追加」のように同じ操作が別の名前で現れない。
export type ListAddAction = { href: string; label: string };

export function ListAddLink({ add }: { add: ListAddAction }) {
  return (
    <Link className="list-add-link" href={add.href}>
      <span aria-hidden="true">＋</span>{add.label}
    </Link>
  );
}
