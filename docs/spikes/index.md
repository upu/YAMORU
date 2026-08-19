# Spikes

実装前に構造上のリスクを検証した技術スパイクの結果を、1件ずつのOKF `type: Spike Report`文書として記録する。

## Reading rules

- スパイク結果は、検証時点の制約と後続実装への注意点の記録であり、意思決定(YDR)そのものではない。恒久的な仕様変更が必要な場合は、別途YDRを起票する。
- 各文書はスパイクの実装(コード・マイグレーション・テスト)へのパスを明記する。実装が変更・削除された場合、文書は過去の検証結果として扱う。

## 一覧

| 対象 | 検証内容 | 文書 |
|---|---|---|
| Supabase RLS | household_idとRLSによる家庭間データ分離 | [supabase-rls-household-isolation.md](supabase-rls-household-isolation.md) |
| Supabase招待受諾 | 期限付き一回限りの招待受諾とRLSによる家庭間分離 | [household-invitation-acceptance.md](household-invitation-acceptance.md) |
| Cloudflare Workers + D1 | Cloudflare中心構成(B案)への移行可否、RLS代替のアプリ層認可 | [cloudflare-workers-d1.md](cloudflare-workers-d1.md) |
