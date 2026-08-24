"use client";

import { useEffect } from "react";

const CONFIRM_PATH = "/invitations/accept/confirm";

// 認証Server Actionは/loginへのPOSTとして実行されるため、招待パスだけに
// 限定したclaim cookieを受け取らない。いったんこの画面を描画し、ブラウザの
// 通常ナビゲーションで確認画面を開くことでcookieを安全なpathのまま引き継ぐ。
export default function ResumeInvitationPage() {
  useEffect(() => {
    window.location.replace(CONFIRM_PATH);
  }, []);

  return (
    <main className="detail-page">
      <section aria-labelledby="invitation-resume-title" className="detail-card">
        <h1 id="invitation-resume-title">招待の確認へ進みます</h1>
        <p>
          自動的に進まない場合は、<a href={CONFIRM_PATH}>招待を確認する</a>を押してください。
        </p>
      </section>
    </main>
  );
}
