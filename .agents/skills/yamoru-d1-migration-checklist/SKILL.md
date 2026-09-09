---
name: yamoru-d1-migration-checklist
description: YAMORUのCloudflare D1に対するschema、データ、テーブル・列などの用語、制約、索引、外部キーを変更するとき、実装前に配備順、旧・新Worker互換性、データ保持、家庭境界、migrationテスト、YDRを設計し、実装後に検証する。D1へ影響しない通常のUI・CSS・文言だけの変更には使わない。
---

# YAMORU D1 Migration Checklist

D1変更を始める前にこのチェックリストを実施し、操作モデルと段階移行を明示してから実装する。既存コードや正本と矛盾し、明示的な置き換え関係でも解決できない場合は、実装を止めて矛盾を報告する。

## 1. 対象を判定する

テーブル、列、制約、索引、外部キー、trigger、保存済みデータ、またはそれらの用語を変更する場合に使う。D1の読み書きや家庭・利用者境界を変える変更にも使う。

次には使わない。

- D1へ影響しないUI、CSS、表示文言だけの変更
- 特定のschema変更を伴わない一般的なCloudflare D1の調査
- production / preview D1の運用作業や手動変更

## 2. 正本を読む

実装を読む前に、次の順で必要な範囲を読む。

1. `docs/index.md`
2. `docs/components/index.md`の対応表から対象機能の実装、テスト、詳細文書
3. `docs/references/database-change-playbook.md`
4. `docs/decisions/index.md`と、関係する`Accepted`かつ置き換えられていないYDR
5. `d1/migrations/`、生成物`d1/schema.generated.sql`、対象の`src/lib/d1/`、対象の`*.d1-test.ts`
6. migration登録先`src/lib/d1/test-support/migrations.ts`と、変更対象を削除するfixture cleanup

`d1/migrations/`をschemaの正本として扱う。`d1/schema.generated.sql`は直接編集しない。

## 3. 変更モデルを書く

コードを変更する前に、Issueまたは作業メモへ次を具体的に書く。

- 利用者が行う操作と、その操作で保存・更新・削除される事実
- データがhousehold共有かuser個人か、および親子行の家庭一致を守る方法
- 既存行、ID、timestamp、履歴を何として保持するか
- 更新失敗時に旧Workerへ戻せる条件と、forward fixが必要になる条件
- 追加、更新、削除、cascadeが各構造へ与える影響

さらに、次の4状態を表または箇条書きにして、各状態で許可する読み書きと互換性を示す。

1. 現在のWorkerと現在のschema
2. migration適用直後に現在のWorkerが動く状態
3. migration適用後に次のWorkerが動く状態
4. 互換期間終了後にcontract migrationを適用した状態

状態2または3で必要な操作が壊れる設計のまま実装しない。

## 4. 段階移行を決める

preview / productionではmigrationが新Workerより先に適用されることを前提に、次の順で判断する。

1. 追加だけで旧Workerと新Workerが同時に動くなら、後方互換なexpand migrationにする。
2. rename、replacement、drop、`NOT NULL`追加などの制約強化で旧Workerが壊れるなら、一度で完了させない。
3. 新構造を追加し、既存行と元のtimestampをコピーし、必要に応じて新旧経路をtriggerなどで同期する。
4. 新Workerはexpand後の構造を使うが、互換期間中は旧WorkerのINSERT / UPDATE / DELETEとロールバックを成立させる。
5. 旧Workerを使わないこととロールバック期間の終了を確認してから、別Issue・別の連番contract migrationで旧構造、同期処理、暫定制約を削除する。

適用済みmigrationを編集、rename、削除しない。production適用後の問題も新しい連番migrationでforward fixする。不可逆な変換が必要なら、失われる情報、復旧方法、実施条件を明示し、安全性を証明できなければ停止する。

contract migrationをこの変更に含めない場合は、実行可能になる条件、削除対象、別Issueへのポインタを残す。別Issueがまだなければ、未作成であることを報告し、作成を成果物に含めるか確認する。

## 5. 実装の漏れを防ぐ

- 未使用の次番号で`d1/migrations/`へ新規migrationを追加する。
- `src/lib/d1/test-support/migrations.ts`へ同じ順序で登録する。
- schema変更がfixtureの削除順、固定テストアカウントの初期化、cascadeに影響する場合はcleanupを更新する。
- `npm run d1:schema:generate`で`d1/schema.generated.sql`を再生成する。
- Accepted YDRの過去の判断を黙って書き換えない。判断を変える場合は新しいYDRを追加し、旧・新YDRと`docs/decisions/index.md`に置き換え関係を記録する。

## 6. 必要十分なテストを選ぶ

変更に関係する観点を選び、選ばなかった重要観点には理由を残す。

### Migrationと互換性

- 全migrationを適用する空の新規DB
- 直前migrationまで適用し、既存fixtureを入れてから新migrationを適用する更新DB
- 既存行、ID、timestamp、履歴の保持
- 旧経路から新構造、新経路から旧構造への同期
- INSERT、UPDATE、DELETEと、親削除時のcascade
- triggerやコピーの冪等性、一意制約、途中失敗時の原子性
- 互換期間に旧Workerと新Workerが必要とするSQL

### 認可境界

- household AのmemberがAだけを読み書きできる
- household BのIDをAの正規セッションへ渡しても読めず変更できない
- 非memberと未認証を拒否する
- user個人データを同じhouseholdの別userが操作できない
- 複合外部キーなどで親子行のhousehold不一致を拒否する

### 生成schemaと品質

少なくとも次を実行し、変更に応じて対象テストを追加する。

```text
npm run d1:migrate
npm run d1:schema:check
npm run test:d1
npm test
npm run lint
npm run build
npm run typecheck
```

`npm run d1:schema:check`で、全migrationから作った新規DBと`d1/schema.generated.sql`の一致を確認する。コマンドを省略または失敗した場合は、その事実と理由を報告する。

## 7. 安全境界と報告

- production / preview D1へmigrationやSQLを手動適用しない。
- 家庭の実データ、非公開資料、認証情報、Secretをfixture、ログ、Issue、commitへ含めない。
- 実施していないproduction実データ、preview、実端末の確認を成功と表現しない。
- 実装前に作成した4状態の互換性、実装したmigration、データ保持方法、追加したテスト、実行したコマンドを完了報告へ含める。
- 残した互換構造について、contract migrationの条件と別Issueを完了報告へ含める。
