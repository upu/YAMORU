"use server";

import { notFound, redirect } from "next/navigation";

import { requireUser } from "../../../lib/auth/current-user";
import { approveAuthorization, denyAuthorization } from "../../../features/integration/oauth/authorize";
import { buildAuthorizationResponseUrl } from "../../../features/integration/oauth/authorization-request";
import { getOAuthRuntime } from "../../../features/integration/oauth/runtime";
import { loadAuthorizationContext } from "./authorization-context";
import { DISPLAYED_CLIENT_NAME_FIELD, isSameConsentScreen } from "./consent-snapshot";

function stringValues(values: FormDataEntryValue[]): string[] {
  return values.filter((value): value is string => typeof value === "string");
}

// 同意画面の「許可する」「許可しない」。Server ActionのOrigin検査がCSRFを防ぐ。
// hiddenで受け取った元の認可要求は信用せず、表示時と同じ検証をやり直す。
export async function decideAuthorization(formData: FormData): Promise<void> {
  const { config, db } = await getOAuthRuntime();
  if (config === null) notFound();
  const user = await requireUser();
  const rawRequest = formData.get("request");
  const params = new URLSearchParams(typeof rawRequest === "string" ? rawRequest : "");
  const context = await loadAuthorizationContext(db, config, user, params);
  if (context.kind === "redirect") redirect(context.url);
  if (context.kind === "page_error") redirect(`/oauth/authorize?${params.toString()}`);
  const { client, household, request } = context;
  if (formData.get("decision") !== "approve") redirect(denyAuthorization(config, request));
  // 表示した後に接続元の名前が変わったら、新しい名前で同意画面を出し直す。
  if (!isSameConsentScreen(formData.get(DISPLAYED_CLIENT_NAME_FIELD), client)) {
    redirect(`/oauth/authorize?${params.toString()}`);
  }
  if (household === null) {
    redirect(buildAuthorizationResponseUrl(request.redirectUri, config, { error: "access_denied" }, request.state));
  }
  const url = await approveAuthorization({ config, db }, {
    approvedScopes: stringValues(formData.getAll("scope")),
    householdId: household.id,
    request,
    userId: user.id,
    userSessionVersion: user.sessionVersion,
  });
  redirect(url);
}
