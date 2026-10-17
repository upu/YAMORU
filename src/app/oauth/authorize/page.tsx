import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "../../../lib/auth/current-user";
import { getOAuthRuntime } from "../../../features/integration/oauth/runtime";
import { loadAuthorizationContext } from "./authorization-context";
import { AuthorizationErrorCard, ConsentCard, NoHouseholdCard } from "./consent-card";

export const metadata: Metadata = { referrer: "no-referrer", title: "外部サービスとの連携 | YAMORU" };

type SearchParams = Record<string, string | string[] | undefined>;

function toSearchParams(values: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry !== undefined) params.append(name, entry);
    }
  }
  return params;
}

// 外部クライアントが利用者を送ってくる同意画面(#436)。ログインしていなければ、
// この認可要求へ戻る形でログインへ誘導する。
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { config, db } = await getOAuthRuntime();
  if (config === null) notFound();
  const params = toSearchParams(await searchParams);
  const user = await getCurrentUser();
  if (user === null) {
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${params.toString()}`)}`);
  }
  const context = await loadAuthorizationContext(db, config, user, params);
  if (context.kind === "redirect") redirect(context.url);
  return (
    <main className="page-form">
      <header className="auth-hero">
        <p className="eyebrow">CONNECT</p>
        <h1>外部サービスとの連携</h1>
      </header>
      {context.kind === "page_error" ? <AuthorizationErrorCard error={context.error} /> : null}
      {context.kind === "consent" && context.household === null ? (
        <NoHouseholdCard rawRequest={params.toString()} />
      ) : null}
      {context.kind === "consent" && context.household !== null ? (
        <ConsentCard
          client={context.client}
          email={user.email}
          household={context.household}
          rawRequest={params.toString()}
          request={context.request}
        />
      ) : null}
    </main>
  );
}
