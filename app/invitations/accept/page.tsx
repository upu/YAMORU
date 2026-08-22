"use client";

import { useEffect, useRef } from "react";

import { openInvitationClaimAction } from "./actions";

const CONFIRM_PATH = "/invitations/accept/confirm";
const TOKEN_HASH_KEY = "token";

// 生tokenを含むURL fragment(#token=...)を読み取る。fragmentはHTTP requestへ
// 送信されないため、この関数はブラウザー内だけで完結する(#140)。
function extractToken(hash: string): string | null {
  if (hash.length <= 1) return null;
  const token = new URLSearchParams(hash.slice(1)).get(TOKEN_HASH_KEY);
  return token !== null && token.length > 0 ? token : null;
}

// 招待リンクの入口。生tokenをrequest URLへ一切含めないため、この画面は
// クライアント側でだけtokenを扱う。
//
// 1. アドレス欄のfragmentから生tokenを読み取る
// 2. 読み取り次第、アドレス欄・閲覧履歴からfragmentを直ちに取り除く
// 3. Server Action(request body経由)で生tokenをD1上の短命claimへ交換し、
//    HttpOnly cookieへ引き継ぐ
// 4. 成否によらず、共通エラー表示を持つ確認画面へ進む(YDR-023)
//
// JavaScriptが無効な場合はfragmentを読み取れず、この画面から進めない。
export default function AcceptInvitationPage() {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const token = extractToken(window.location.hash);
    window.history.replaceState(null, "", window.location.pathname);

    void (async () => {
      if (token !== null) await openInvitationClaimAction(token);
      window.location.replace(CONFIRM_PATH);
    })();
  }, []);

  return (
    <main className="detail-page">
      <section aria-labelledby="invitation-loading-title" className="detail-card">
        <h1 id="invitation-loading-title">招待を確認しています</h1>
        <p>自動的に進まない場合は、しばらくお待ちください。</p>
        <noscript>
          この招待リンクを開くにはJavaScriptを有効にしてください。
        </noscript>
      </section>
    </main>
  );
}
