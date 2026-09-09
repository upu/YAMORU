---
type: Decision
ydr_id: YDR-044
title: よく使う消耗品を「ピン留め」と呼び、DB名を段階移行する
description: ホームへ固定して素早く操作する個人別Consumable機能をピン留めと呼び、旧Workerとの互換性を保つexpand-first migrationで内部名を段階移行する
tags: [yamoru, decisions, ydr, consumable, pin, migration]
status: stable
decision_status: Accepted
decision_date: 2026-09-09
supersedes: YDR-043
---

# YDR-044: よく使う消耗品を「ピン留め」と呼び、DB名を段階移行する

- 状態: Accepted
- 決定日: 2026-09-09
- 置き換える決定: [YDR-043](ydr-043-cross-search-quick-actions.md)(「お気に入り」という名称と、YDR-042から維持した同名称の部分だけを置き換える。横断検索の操作境界は変更しない)

## 背景

[Issue #345](https://github.com/upu/YAMORU/issues/345)で、利用者ごとによく使うConsumableをホームへ固定する機能を「お気に入り」として追加した。機能の実態は好きなものを示すことではなく、卵、トイレットペーパー、洗剤など、よく確認・操作する項目をホームへ固定することである。[Issue #375](https://github.com/upu/YAMORU/issues/375)では、利用者に伝わる概念名と実装名を「ピン留め」へ揃える。

一方、previewとproductionのデプロイではD1 migrationを新しいWorkerより先に適用する。適用済みの`user_consumable_favorites`を同じmigrationでrenameすると、切り替え前のWorkerやロールバックしたWorkerが旧テーブルを読めず停止する。そのため、名称統一はexpand-firstで段階移行する必要がある。

## 決定

### 1. 利用者向けとアプリケーション内部の名称

- UIでは見出しを「ピン留め」、追加操作を「ホームにピン留め」、解除操作を「ピン留めを外す」とする。
- TypeScript / Reactのファイル名、型、関数、props、CSS class、フォーム項目は`pin` / `pinned` / `pins`へ揃える。
- 消耗品詳細では星ではなくピンを表すアイコンを使い、アクセシブルネームにも同じ用語を使う。

### 2. 操作と共有境界は変えない

- ピン留めは認証済み利用者ごとの可逆な設定で、件数を制限しない。
- ホームでは最近ピン留めした5件を先に表示し、6件以上は残りを展開・折りたたみできる。
- Consumable本体と在庫状態は家庭共有のままとし、ホームのピン留めから既存の3状態を直接変更できる。
- 横断検索にはピン留め操作を追加しない。YDR-043で採用した在庫変更・Todo完了だけの操作境界と、YDR-042から維持した検索対象・入口・認可をすべて維持する。

### 3. D1はexpand-firstで段階移行する

- 適用済み`0025_user_consumable_favorites.sql`は変更しない。
- `0026_user_consumable_pins.sql`で同じ利用者・家庭境界を持つ`user_consumable_pins`を追加し、既存行と登録日時をコピーする。
- 新旧Workerが同時に動くデプロイ中とロールバック期間は、D1 triggerで旧テーブルと新テーブルの追加・削除を双方向に同期する。
- 新しいアプリケーションコードは`user_consumable_pins`だけを読み書きする。旧テーブル名はmigration、移行テスト、互換性を説明する文書にだけ残す。
- 旧Workerを使わないこととロールバック期間の終了を確認した後、旧テーブルと同期triggerの削除を別Issue・別migrationで行う。`0026`自体は書き換えない。

## 検討した案

- **案1(採用)**: 新テーブルを追加し、新旧テーブルを一時的に同期する。デプロイ途中とWorkerのロールバックに耐えられる。
- 案2: 同じmigrationで旧テーブルと列をrenameする。内部名は一度で揃うが、新Worker配備前から旧Workerが壊れるため採用しない。
- 案3: UIだけを「ピン留め」に変え、内部名を維持する。利用者には伝わるが、概念名とコードのずれが残り、今後の検索・保守を難しくするため採用しない。

## 結果

- 利用者には「ホームへ固定する」操作として一貫した名称とアイコンが表示される。
- 個人別の設定、家庭共有の在庫、5件表示と展開という既存の操作契約は変わらない。
- migration適用から新Worker配備完了までの間も旧Workerが動作し、配備失敗時も旧Workerへロールバックできる。
- 互換テーブルと同期triggerを一時的に持つため、contract migrationを行うまでスキーマは二重になる。

## 見直す条件

- previewとproductionの双方で新Workerへの切り替えが完了し、旧Workerへ戻す運用期間が終わった場合。旧テーブルと同期triggerを削除する後続Issueを作る。
- 双方向同期による書き込み負荷や不整合が観測された場合。削除を急がず、forward fixのmigrationで同期方法を見直す。
- 実利用で「ピン留め」がホームへの固定操作として伝わらないと分かった場合。UI文言だけでなく本決定を置き換える新しいYDRで概念名を再検討する。
