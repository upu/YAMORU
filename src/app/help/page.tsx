import Link from "next/link";

import {
  APP_VERSION_INFO,
  type AppVersionInfo,
  formatDetailedAppVersion,
} from "../app-version";

export function HelpContent({ versionInfo }: { versionInfo: AppVersionInfo }) {
  return (
    <main className="detail-page help-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/">← ホームへ戻る</Link>
      </nav>

      <header className="detail-hero">
        <p className="eyebrow">サポート</p>
        <h1>ヘルプ</h1>
        <p>YAMORUについて問い合わせるときに必要な情報を確認できます。</p>
      </header>

      <section aria-labelledby="version-title" className="detail-card">
        <h2 id="version-title">バージョン情報</h2>
        <p className="app-version-detail">
          {formatDetailedAppVersion(versionInfo)}
        </p>
        <p>この一行をそのままお伝えください。</p>
      </section>
    </main>
  );
}

export default function HelpPage() {
  return <HelpContent versionInfo={APP_VERSION_INFO} />;
}
