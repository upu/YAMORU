---
okf_version: "0.2"
---

# YAMORU Knowledge Bundle

YAMORUのプロダクト知識を、人間とAIが同じMarkdownから段階的に読めるように整理する。

## Product

- [Product knowledge](product/index.md) - ビジョン、対象利用者、MVP、ロードマップ

## Decisions

- [Decision knowledge](decisions/index.md) - 現在有効な判断と、その背景・見直し条件

## Components

- [Component knowledge](components/index.md) - プロダクトとソフトウェアの責務境界。実装開始に合わせて追加する

## Development

- [Development knowledge](development/index.md) - ローカル開発環境、テスト、実端末・PWA確認

## Spikes

- [Spike knowledge](spikes/index.md) - 実装前に構造上のリスクを検証した技術スパイクの結果

## References

- [Reference knowledge](references/index.md) - レビュー手順や外部資料への参照

## Database

- [データベースに影響する変更の手順](references/database-change-playbook.md) - 現在のスキーマをどこで確認するか、スキーマを変更するときに何を実行するか
- [Auth.js初回bootstrapとパスワード再設定](references/auth-admin-operations.md) - local / preview / production D1で最初のアカウントを作成し、運用者がパスワードを再設定する手順
- [Cloudflare productionの構築・デプロイ・復旧](references/cloudflare-production-operations.md) - Workers + D1の環境分離、Secrets、CI/CD、ログ、ロールバック手順

## Reading rules

- まずこの索引を読み、作業に関係する文書だけを開く。
- 現在のデータベース定義は`d1/migrations/`、アプリ層の家庭間分離は`src/lib/d1/`、実D1上の境界・原子性テストは`src/lib/d1/**/*.d1-test.ts`を正本として読む。詳細な変更手順は`docs/references/database-change-playbook.md`を参照する。
- 概念文書の`status: deprecated`は、現在の仕様ではなく過去の経緯として扱う。`status`がなければ`stable`として扱う。
- 意思決定は各YDR本文の状態を確認し、`Accepted`かつ後続のYDRで置き換えられていないものだけを現在有効として扱う。
- 外部情報を扱う概念文書に`stale_after`がある場合は、期限と出典を確認する。
- `docs/`配下にOKF文書を新規作成・移行する前に、[OKF文書の執筆ガイド](references/okf-authoring-guide.md)を読む。
