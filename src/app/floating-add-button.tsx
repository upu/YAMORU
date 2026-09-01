import Link from "next/link";

type AddDestination = "consumable" | "managed-item" | "todo";

// Issue #309: 台帳のどのカテゴリを見ていても、右下の追加操作は同じ位置・同じ
// 名前で見つかるようにする。行き先だけを現在のカテゴリ(備品・サービス・契約は
// ManagedItem、消耗品はConsumable)へ合わせる。
const DESTINATIONS: Record<AddDestination, { href: string; label: string }> = {
  consumable: { href: "/consumables/new", label: "台帳に追加" },
  "managed-item": { href: "/managed-items/new", label: "台帳に追加" },
  todo: { href: "/todos/new", label: "Todoを追加" },
};

export function FloatingAddButton({
  destination,
}: {
  destination: AddDestination;
}) {
  const { href, label } = DESTINATIONS[destination];

  return (
    <>
      <div aria-hidden="true" className="floating-add-button-space" />
      <Link
        aria-label={label}
        className="floating-add-button"
        href={href}
        title={label}
      >
        <span aria-hidden="true">＋</span>
      </Link>
    </>
  );
}
