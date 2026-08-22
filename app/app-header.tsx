"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const PUBLIC_PATH_PREFIXES = ["/login", "/invitations/accept"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function AccountIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />
    </svg>
  );
}

function AccountMenuPanel({
  isSigningOut,
  onClose,
  onSignOut,
  pathname,
}: {
  isSigningOut: boolean;
  onClose: () => void;
  onSignOut: () => void;
  pathname: string;
}) {
  return (
    <nav
      aria-label="アカウントメニュー"
      className="account-menu-panel"
      id="account-menu-panel"
    >
      <Link
        aria-current={pathname.startsWith("/account") ? "page" : undefined}
        href="/account"
        onClick={onClose}
      >
        アカウント
      </Link>
      <Link
        aria-current={pathname.startsWith("/household") ? "page" : undefined}
        href="/household"
        onClick={onClose}
      >
        家庭
      </Link>
      <form action="/auth/signout" method="post" onSubmit={onSignOut}>
        <button disabled={isSigningOut} type="submit">
          {isSigningOut ? "ログアウト中…" : "ログアウト"}
        </button>
      </form>
    </nav>
  );
}

function AccountMenu({ pathname }: { pathname: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsidePress(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !menuRootRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="account-menu-root" ref={menuRootRef}>
      <button
        aria-controls="account-menu-panel"
        aria-expanded={isOpen}
        aria-label="アカウントメニュー"
        className="account-menu-trigger"
        onClick={() => {
          setIsOpen((current) => !current);
        }}
        ref={triggerRef}
        type="button"
      >
        <AccountIcon />
      </button>
      {isOpen ? (
        <AccountMenuPanel
          isSigningOut={isSigningOut}
          onClose={() => {
            setIsOpen(false);
          }}
          onSignOut={() => {
            setIsSigningOut(true);
          }}
          pathname={pathname}
        />
      ) : null}
    </div>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  if (isPublicPath(pathname)) return null;

  return (
    <header aria-label="共通ヘッダー" className="app-header">
      <div className="app-header-inner">
        <Link className="app-header-brand" href="/">YAMORU</Link>
        <AccountMenu key={pathname} pathname={pathname} />
      </div>
    </header>
  );
}
