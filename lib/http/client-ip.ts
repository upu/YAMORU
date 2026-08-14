const UNKNOWN_CLIENT_IP = "unknown";

// Issue #70: 招待claim交換(open_invitation_claim)のIPアドレス単位レート制限に使う。
//
// 信頼の前提: 本番はVercelを第一候補とする(docs/product/yamoru-project-plan.md
// 「配信・運用」)。Vercelのエッジはx-forwarded-forをプラットフォーム側で
// 設定し、クライアントが送った値を上書きするため、この値は偽装できない。
// Vercel以外(自己ホスティング等)へ配信する場合は、同等の保証を持つ
// リバースプロキシを前段に置く必要がある。そうでない構成でこの関数を使うと、
// クライアントが任意のx-forwarded-forを送ることでIP単位の制限を回避できる
// (Web/API層の外側=直接RPC呼び出しは、この関数を経由しないため既に
// service_role専用境界で塞いでいる。ここが守るのはWeb/API層自身への
// なりすましIPによる回避)。
//
// IPを特定できない場合は固定の代表値にまとめる。これは制限の回避ではなく、
// 特定できない発信元をまとめて同じ(より厳しい)制限バケットへ寄せる方向になる。
export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor !== null) {
    const firstEntry = forwardedFor.split(",")[0].trim();
    if (firstEntry.length > 0) {
      return firstEntry;
    }
  }

  const realIp = headers.get("x-real-ip");
  if (realIp !== null && realIp.trim().length > 0) {
    return realIp.trim();
  }

  return UNKNOWN_CLIENT_IP;
}
