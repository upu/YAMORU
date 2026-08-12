# Spikes

実装前に構造上のリスクを検証した技術スパイクの結果を、1件ずつのOKF `type: Spike Report`文書として記録する。

## Reading rules

- スパイク結果は、検証時点の制約と後続実装への注意点の記録であり、意思決定(YDR)そのものではない。恒久的な仕様変更が必要な場合は、別途YDRを起票する。
- 各文書はスパイクの実装(コード・マイグレーション・テスト)へのパスを明記する。実装が変更・削除された場合、文書は過去の検証結果として扱う。

## 一覧

| 対象 | 検証内容 | 文書 |
|---|---|---|
| Supabase RLS | household_idとRLSによる家庭間データ分離 | [supabase-rls-household-isolation.md](supabase-rls-household-isolation.md) |
