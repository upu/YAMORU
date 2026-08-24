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
  const passwordChanged =
    firstSearchParamValue(resolvedSearchParams.passwordChanged) === "1";

  return (
    <main className="auth-page">
      <header className="auth-hero">
        <p className="eyebrow">FAMILY AUTH</p>
        <h1>YAMORUへログイン</h1>
        <p>招待された家族のアカウントでログインしてください。</p>
      </header>
      {passwordChanged ? (
        <p className="auth-feedback" role="status">
          パスワードを変更しました。新しいパスワードでログインしてください。
        </p>
      ) : null}
      <LoginForm next={next ?? undefined} />
    </main>
  );
}
