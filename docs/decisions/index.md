# Decisions

## Current source

- [YAMORU意思決定ログ](yamoru-decision-log.md) - YDR-001からYDR-016までの現在の正本

## Migration note

意思決定は、今後1件ずつOKFの`type: Decision`文書へ分割する。分割が完了するまでは、上記の統合ログを正本とする。

移行時は次を守る。

- AcceptedかつSupersededされていないYDRだけを現在有効とする。
- 過去の判断を削除せず、`supersedes`と`superseded_by`で関係を明示する。
- 新しい判断から1件1ファイル方式を先に適用し、既存YDRは別の小さな変更で移行する。
- 分割完了時は、この索引と`AGENTS.md`の正本に関する記述を同じ変更で更新する。
- READMEなどからの導線は、個別の意思決定ファイルではなく、この索引を参照する。
