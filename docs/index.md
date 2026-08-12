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

## Spikes

- [Spike knowledge](spikes/index.md) - 実装前に構造上のリスクを検証した技術スパイクの結果

## References

- [Reference knowledge](references/index.md) - レビュー手順や外部資料への参照

## Reading rules

- まずこの索引を読み、作業に関係する文書だけを開く。
- 概念文書の`status: deprecated`は、現在の仕様ではなく過去の経緯として扱う。`status`がなければ`stable`として扱う。
- 意思決定は各YDR本文の状態を確認し、`Accepted`かつ後続のYDRで置き換えられていないものだけを現在有効として扱う。
- 外部情報を扱う概念文書に`stale_after`がある場合は、期限と出典を確認する。
- `docs/`配下にOKF文書を新規作成・移行する前に、[OKF文書の執筆ガイド](references/okf-authoring-guide.md)を読む。
