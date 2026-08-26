import Link from "next/link";

type AddDestination = "managed-item" | "todo";

const DESTINATIONS: Record<AddDestination, { href: string; label: string }> = {
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
        <span aria-hidden="true">⊕</span>
      </Link>
    </>
  );
}
