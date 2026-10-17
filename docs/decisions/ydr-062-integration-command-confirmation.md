---
type: Decision
ydr_id: YDR-062
title: 古いpreviewの作り直しで意味のある差分が出た変更だけ、本人の追加確認を必須にする
description: staleになった操作と作り直しをサーバーが記録して対応付け、利用者にとって意味のある差分があるときだけYAMORUの確認画面での承認と一回限りのtokenを求める
tags: [yamoru, decisions, ydr, integration, d1, security]
status: stable
decision_status: Accepted
decision_date: 2026-10-17
supersedes: [YDR-054]
---

# YDR-062: 古いpreviewの作り直しで意味のある差分が出た変更だけ、本人の追加確認を必須にする

- 状態: Accepted
- 決定日: 2026-10-17
- 関連: [#437](https://github.com/upu/YAMORU/issues/437)、[YDR-049](ydr-049-conversation-command-boundary.md)、[YDR-053](ydr-053-conversation-read-revisions.md)、[YDR-054](ydr-054-integration-command-receipts.md)、[会話連携設計](../product/conversation-integration.md) 5節
- 置き換える範囲: YDR-054の「追加確認はまだ扱わず、`confirmation_token`には`unsupported_capability`を返す」という現状の記述だけ。受付記録とbatchの確定方式は引き継ぐ。

## 背景

会話連携設計5節は、commit競合を`stale_preview`で差分の再確認へ戻し、「再prepareは最新状態を読んだ新操作IDへ移り、変更された差分には`confirmation: required`を返す」と定めている。確認画面(`/settings/integrations/operations/{preview_id}/confirm`)、`operation_get`の確認状態、一回限りの`confirmation_token`も契約にある。一方、どの場合に確認を必須にするかは決まっていなかった。

[YDR-049](ydr-049-conversation-command-boundary.md)は、明確で委任範囲に収まる指示に不要な再確認を重ねないとしている。利用者は次を選んだ。

- 日常の明確な操作は、取消や次回以降の条件変更を含めて、一律の追加確認を求めない。
- 古いpreviewを作り直した結果、利用者が同意した内容から意味のある差分が出たときだけ、本人の追加確認を必須にする。
- staleな操作と作り直しの対応は、推測ではなくサーバーが記録して追跡する。新しい操作IDに変えても確認を回避できない。
- 比較するのは対象・変更内容・次回への影響など、利用者にとって意味のある差分とする。無関係な家庭更新でrevisionだけが変わった場合は確認を求めない。
- 確認した後に内容が再び変わったら、古い承認・tokenを引き継がない。

## 決定

1. 受付記録ごとに「何に対する操作か」を表す`subject_key`を保存する。対象を持つcommandは`command`と対象(kind・ID)、対象を持たない登録系は`command`と正規化payload(prepare時刻`reference_at`を除く)のSHA-256から作る。
2. 受付記録ごとに、previewから作る「意味のある内容」の指紋`meaningful_digest`を保存する。previewの対象・差分・次回への影響を正規化JSONにし、revisionを表す値(キー名が`revision`で終わるもの)を除く。実施日時を省略してprepare時刻を使った完了は、時刻ではなく実施日だけを比べる。
3. 同じ本人・同じ家庭・同じ`subject_key`の、24時間以内で最新の受付記録を、prepareのたびにサーバーが引く。接続やclientは問わないため、再接続や別のclientに変えても回避できない。最新の記録が次のどちらかなら、確認待ちの連鎖が続いているとみなす。
   - `stale_preview`で拒否された記録
   - 確認が必須で、まだ成功していない記録(確認待ち・拒否・期限切れを含む)
4. 連鎖が続いている場合は、利用者が最後に同意した内容(連鎖の起点、または承認された記録)の`meaningful_digest`を基準とし、新しいpreviewと比べる。
   - 同じなら、無関係な家庭更新でrevisionだけが変わったとみなし、確認を求めない。この記録が新しい基準になる。
   - 違えば`confirmation.state: required`、`reason_codes: ["changed_after_stale_preview"]`を返し、`confirmation_url`と期限を示す。基準は引き継ぐ。
   どちらの場合も、作り直した記録に直前の記録への対応(`supersedes_operation_id`)と基準(`baseline_operation_id`)を保存する。
5. 確認画面はYAMORUへログインした本人だけが開ける。preview IDは推測困難なUUIDとし、URLへtokenや家庭情報を含めない。GETでは承認しない。画面には接続元、基準の内容と現在の内容、次回への影響を示す。承認・拒否はServer Action(POST、Next.jsのOrigin検証によるCSRF保護)で記録する。承認は一つの条件付き更新で、本人・家庭・未実行・期限内・確認待ち・接続が書き込みに使えること・家庭の世代がpreview時と同じことを確かめる。世代が変わっていれば承認せず`stale_preview`として確定させ、会話での作り直しへ戻す(次の作り直しも同じ基準と比べる)。拒否は操作を`confirmation_denied`として確定させる。
6. `operation_get`は確認状態(`pending / approved / denied / expired`)を返す。承認済み・未実行・期限内で、要求した接続が元の接続であり、元commandに必要なscopeを持つときだけ`confirmation_token`を返す。tokenは保存せず、サーバーの秘密鍵(AUTH_SECRETを用途別の文脈で使うHMAC)で、受付記録ID・preview ID・fingerprint・接続・本人・家庭・期限・承認時刻から都度計算する。保存しないため、DBやログから漏れない。
7. 確認が必須の操作のcommitは、正しいtokenと承認済みの状態を両方求める。どちらかが欠ければ`confirmation_required`を返し、操作は確定させない。受付記録を成功へ進める最後の文にも「確認不要、または承認済み」を条件として加え、さらにDBのtriggerで、承認されていない確認必須の操作が`succeeded`になることを拒否する。一度成功した操作の再送は保存した結果を返し、tokenで再実行しない。
8. tokenは一つの受付記録にだけ束縛する。確認の後に内容が変わればcommitは`stale_preview`になり、作り直した操作は新しい受付記録として改めて確認を求める。古い承認・tokenは新しい記録に効かない。

## 比較した案

- クライアントが作り直し元の操作IDを申告する: 申告しなければ確認を回避できるため採用しない。
- 同じ接続の直前の操作だけを見る: 再接続や別clientで回避できるため、本人・家庭で追跡する。
- revisionの変化だけで確認を求める: 家庭単位の世代(YDR-053)は無関係な家族の更新でも進むため、日常の操作に不要な確認が増える。
- tokenを暗号化して保存する: 復号鍵の管理と漏えい時の影響範囲が増える。都度計算すれば保存が要らない。
- 取消・次回以降の条件変更を常に確認必須にする: 利用者は、明確な指示なら一律の追加確認は不要と判断した。

## 結果と見直す条件

- `integration_operations`へ列とtriggerを足す(migration 0043、追加だけのexpand migration)。旧Workerは新しい列を書かず、すべて確認不要の操作として動く。旧Workerへ戻した期間に確認必須の操作が残っていても、triggerが承認なしの成功を拒否する。
- 24時間を過ぎた古い連鎖は追わない。会話の間隔として不足する事例が出たら延長を検討する。
- 意味のある差分の判定はpreviewの構造に依存する。previewへ利用者に無関係な時刻や世代を足すときは、`meaningful_digest`から除くか、この決定を見直す。
- 新しいエラーコード`confirmation_required`(未承認・token不備、確定させない)と`confirmation_denied`(本人が拒否、確定)を追加する。
