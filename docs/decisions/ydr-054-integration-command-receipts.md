---
type: Decision
ydr_id: YDR-054
title: 外部commandの受付記録を業務更新と同じD1 batchで確定させる
description: prepare時に家庭の世代とともに受付記録を作り、commitのbatchの最初の文で世代を、最後の文で業務の記録・期限・接続の有効性を確かめ、満たさなければbatch全体を取り消す
tags: [yamoru, decisions, ydr, integration, d1]
status: stable
decision_status: Accepted
decision_date: 2026-10-17
---

# YDR-054: 外部commandの受付記録を業務更新と同じD1 batchで確定させる

- 状態: Accepted
- 決定日: 2026-10-17
- 関連: [#437](https://github.com/upu/YAMORU/issues/437)、[YDR-049](ydr-049-conversation-command-boundary.md)、[YDR-053](ydr-053-conversation-read-revisions.md)、[YDR-015](ydr-015-occurrence-state-activitylog-history-safe-undo.md)、[YDR-026](ydr-026-completion-correction-events.md)、[会話連携設計](../product/conversation-integration.md) 5節・8節
- 番号について: YDR-053とmigration 0032は#435(PR #452)が使うため、この決定は054、migrationは0033とする。

## 背景

[YDR-049](ydr-049-conversation-command-boundary.md)は、外部クライアントの変更をprepare/commitの二段階とし、操作ID・fingerprint・保存結果を共通契約にすると決めた。設計5節は、受付記録の成功・履歴・次回生成を同じ成功条件へ束縛し、途中失敗でいずれかだけが残る実装を禁じている。D1のbatchは一つのトランザクションとして実行されるが、条件付き更新が0件でも失敗にはならないため、文を並べるだけでは「業務の記録が書けなかったのに受付記録だけが成功になる」状態を防げない。

既存のWeb操作(完了・取消・訂正)は、条件付きINSERTと`idempotency_key`の一意性で二重記録を防いでいる。ただし関数ごとに別のbatchを実行し、訂正は実施日時と実施者を別のbatchで記録する。

## 決定

1. 受付記録`integration_operations`を追加し、previewを作った時点で1行作る(`prepared`)。操作IDの一意性は接続ごとに保証する。接続は本人・家庭・clientを含むため、別の利用者や再接続後の接続からは旧操作を引けない。最初の要求のhash(`request_hash`)と、確定した内容のfingerprint、正規化したcommand、preview、期限(10分)を保存する。「今」や「昨日」はprepare時に絶対値へ固定し、再prepareやcommitで計算し直さない。
2. previewを作るときの家庭の世代([YDR-053](ydr-053-conversation-read-revisions.md)の`household_read_versions`)を受付記録とfingerprintに含める。読み取りの前後で世代が変われば保存しない。`expected_revision`(読み取りToolのrevision)が指定されたら、その対象が操作の影響を受けることと、世代が同じであることを確かめる。commitは、保存した正規化commandから現在の家庭データでpreviewを計算し直し、previewと世代がどちらも同じときだけ実行する。違えば`stale_preview`として拒否を確定させる。
3. 業務の更新は既存のWeb操作と同じ条件付きSQLを使う。外部command向けに判定を複製しない。業務側の`idempotency_key`は受付記録ごとの`business_key`から作り、受付記録と業務の履歴を結び付ける。
4. commitのbatchは、最初の文で家庭の世代がpreview時と同じであることを確かめる。業務の更新自体が世代を進めるため、業務の文より前に置く。受付記録の成功は、業務更新と同じbatchの最後の文で記録する。この文は、受付記録がまだ`prepared`であること、previewの期限内であること、接続が書き込みに使えること(失効・家庭からの離脱・パスワード変更・`household.write`の除外のいずれでもない)、業務の記録がすべて存在すること、取消・訂正の対象の完了記録が今も最新の完了であることを満たすときだけstatusを`succeeded`へ進める。最初と最後のどちらの文も、条件を満たさなければstatusをNULLに評価してNOT NULL制約でbatch全体を取り消す。こうして、業務の記録と受付記録の成功は必ず同時に残るか、どちらも残らない。実施日時と実施者の同時訂正も一つのbatchで記録し、両方の訂正行の存在を成功条件にする。
5. batchが取り消された場合は、確定した状態から順に理由を調べる。同時のcommitが先に成功していればその結果を返し、期限切れ・接続の失効・業務上の競合(他の家族が完了済み、後続の更新あり、previewとの差異)を区別して返す。業務上の競合は拒否として確定させ、同じ操作IDの再送にも同じ結果を返す。原因を特定できない失敗は確定させず、同じ操作IDでの照合に委ねる。
6. 成功した操作の再送は、previewの期限後でも保存した結果を返し、再実行しない。

## 比較した案

- 受付記録の成功を業務更新の後に別の文で記録する: 間で失敗すると業務の記録だけが残り、再送時に結果を返せない。
- 業務の各文に受付記録の状態を条件として埋め込む: 既存のWeb操作のSQLを外部command向けに複製・改変することになり、判定が二重になる。
- `RAISE()`を使うトリガーで取り消す: 失敗させたい条件が呼び出しごとに異なり、トリガーへ持たせると条件を表で管理する別の仕組みが要る。

## 結果と見直す条件

- 受付記録が成功で業務の記録が無い状態、または業務の記録だけがあり受付記録が未確定の状態は、どちらも起こらないことを実D1で確かめた(確認と実行の間に他の家族の更新や接続の解除を割り込ませるテストを含む)。
- 世代は家庭単位なので、previewから実行までの間に家族が無関係なものを更新しても`stale_preview`になる。YDR-053の保守的な方式をそのまま使う。利用を妨げる頻度になれば、対象別の世代を新たに設計する。
- 追加確認(`confirmation_url`)はまだ扱わず、`confirmation_token`が送られたら`unsupported_capability`を返す。現在のpreviewはすべて`not_needed`である。
- 成功結果の詳細を30日で破棄する処理はまだ無い。追加するときは`result`を最小記録へ置き換え、`result_expired`を返す。
- 取消後の処理はD1のエラーメッセージに依存せず、確定した状態を読み直して理由を決める。NOT NULL制約の違反で取り消されることは、メッセージを判定する`isCommitReceiptRejection`を使ってテストで確かめている。
