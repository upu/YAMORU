import Link from "next/link";
import { requireUser } from "../../../../lib/auth/current-user";
import { getOAuthRuntime } from "../../../../features/integration/oauth/runtime";
import { IntegrationGuide } from "./integration-guide";

export default async function IntegrationGuidePage() {
  await requireUser();
  const { config } = await getOAuthRuntime();
  return <main className="page-form account-page"><nav className="back-nav" aria-label="ページ移動"><Link href="/settings/integrations">← 外部サービスとの連携へ</Link></nav>
    <IntegrationGuide endpoint={config?.resource ?? null} />
  </main>;
}
