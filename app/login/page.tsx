import { toSafeRedirectPath } from "../../lib/auth/safe-redirect";
import { LoginForm } from "./login-form";

function firstSearchParamValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const next = toSafeRedirectPath(firstSearchParamValue(resolvedSearchParams.next));

  return (
    <main className="auth-page">
      <header className="auth-hero">
        <p className="eyebrow">LOCAL AUTH</p>
        <h1>YAMORUへログイン</h1>
        <p>ローカルSupabaseで、登録とログインを確認します。</p>
      </header>
      <LoginForm next={next ?? undefined} />
    </main>
  );
}
