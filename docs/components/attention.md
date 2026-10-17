---
type: Component Map
title: 通知候補の修正箇所マップ
description: 家庭共有の期限と在庫から理由付き候補を生成し、区間と差分を保持する処理
tags: [yamoru, components, integration, notifications]
status: stable
---

# 通知候補

`createAttentionReader(deps).attentionGet({cursor?, limit?, candidate_ids?})`は、検証済みPrincipal・再認可関数・D1・32byte以上のcursor秘密鍵をサーバー側から受け取る。HTTP/MCP公開は#439、本人設定は#441、schedulerと配信は#442の担当。

| 役割 | 入口 |
|---|---|
| 共通読み取り・認可前後の整合性確認 | `src/features/integration/attention/service.ts` |
| 理由・優先順位・日付projection | `src/features/integration/attention/projection.ts` |
| 上限付き再評価・候補・変更列 | `src/lib/d1/attention.ts` |
| 発生区間と旧SQLの解消検知 | `d1/migrations/0034_attention_candidates.sql` |
| 仕様・配備互換性 | [YDR-055](../decisions/ydr-055-attention-candidate-intervals.md) |

## 取得契約

- limitは既定20、最大50（候補とremoved_idsの合計）。candidate_idsも最大50。すべて家庭内に絞る。不存在と他家庭のIDを区別しない。
- 一度に最大100対象を再評価する。未完了なら候補を返さず`refresh_complete=false, next_cursor`を返す。この空配列を「用事なし」と解釈しない。続きも同じlimit/ID条件で呼ぶ。
- `next_cursor`がnullになるまでページを取得し、最後の`sync_cursor`を次回のcursorとして渡す。差分には更新された候補と削除IDが含まれる。差分候補の順序は全件と同じ優先順位だが、クライアントは既存集合を更新し、sort_keyで並べ直す。
- pageは家庭世代・東京暦日・変更列の上限に固定。取得中に変化したら`invalid_cursor/read_conflict`で再取得する。cursorは本人・接続・条件に署名で束縛し15分有効、期限切れならcursorなしで全件を上限付き再取得する。
- 差分ログは家庭削除時にcascade。24時間より古いものを再評価完了時に100件ずつ削除するが、単調なwatermark維持のため家庭の最後の変更行を残す。
- generated_atは今回の評価時刻、候補内generated_atはその内容を生成した時刻。next_check_atは5分後と次の東京午前0時の早い方。変更直後にも再取得でき、配信前には必ず再評価する。時計をクライアント入力から受け取らない。
- candidate_idは発生区間、revisionは候補内容の単調世代。commandを実行するときはentity_getの最新revisionを別に取得する。取得で送信・既読状態を付けない。

## 判定と境界

順序は必達日超過→必達日当日→現在期限→在庫なし→目安超過→期間内→そろそろ→在庫少。最初の4区分はhigh、それ以外はnormal。同区分は必達日/現在期限/推奨期間の終わり、対象kind、IDで整列する。在庫には日付を創作しない。

完了・skippedは除外し、pendingへ戻った完了取消は再評価する。現在のschemaに独立したアーカイブ状態はないため、削除はcascadeで除外し、projectionはpending以外をすべて除外する。将来アーカイブ列を追加する変更はsource viewと終了triggerの更新も必要。

候補の全理由が解消したとき区間を終える。未完了の期間・担当・名称変更や理由の推移だけではIDを変えない。解消→再発は取得の間でも新ID。triggerの解消判断は保存した評価日とDBの現在東京暦日の遅い方を使い、旧WorkerのSQLも捕捉する。候補の期限・在庫は家庭共有、通知先・静かな時間・スヌーズはここでは扱わない。

## 検証

`tests/attention-projection.test.ts`と`src/lib/d1/attention*.d1-test.ts`で日付、理由、家庭境界、再送、差分削除、上限、同時取得、旧SQL、migration互換性を検証する。新しい外部Toolや実配送を検証したことにはならない。
