import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <header className="auth-hero">
        <p className="eyebrow">LOCAL AUTH</p>
        <h1>YAMORUへログイン</h1>
        <p>ローカルSupabaseで、登録とログインを確認します。</p>
      </header>
      <LoginForm />
    </main>
  );
}
