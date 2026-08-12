---
type: Playbook
title: OKF文書の執筆ガイド
description: YAMORUの docs/ 配下でOpen Knowledge Format (OKF) v0.2文書を新規作成・移行するときに参照するフィールド一覧とテンプレート
tags: [yamoru, okf, authoring]
status: stable
---

# OKF文書の執筆ガイド

`docs/`はOpen Knowledge Format (OKF) v0.2を参考に構成されている。このガイドは、`docs/`配下でOKF文書を新規に書く・既存文書を移行するときに参照する執筆ガイドである。公式仕様そのものではない。公式仕様は[Open Knowledge Format v0.2 SPEC](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)を参照する。

## いつ読むか

- `docs/`配下に新しいOKF文書を追加する前
- 既存文書(旧YDR集約ログなど)を個別のOKF文書へ移行する前
- フロントマターの`status`と、意思決定など領域固有の状態を同じ文書に書く前

## 1. フロントマターフィールド一覧

OKF v0.2で`type`のみが必須。他は推奨または任意だが、YAMORUでは以下を基本セットとして揃える。

| フィールド | 必須 | 意味 |
|---|---|---|
| `type` | 必須(OKF上唯一の必須項目) | 文書の種類。OKFは中央登録制ではなく、書き手が説明的な値を選ぶ。読み手は未知の`type`も許容する。YAMORUでの具体例は[2. YAMORUで使う`type`](#2-yamoruで使うtype)を参照 |
| `title` | 推奨 | 表示名。省略時はファイル名から推測される |
| `description` | 推奨 | 一文の要約。索引やプレビューに使う |
| `tags` | 推奨 | 横断的な分類用のYAMLリスト |
| `status` | 任意(OKFライフサイクル) | `draft` / `stable` / `deprecated`のいずれか。省略時は`stable`として扱う。詳細は[3. `status`と領域固有の状態を混同しない](#3-statusと領域固有の状態を混同しない) |
| `stale_after` | 任意 | 外部情報を扱う文書で、鮮度の期限(`YYYY-MM-DD`)を示す |

上記に加え、YAMORUの`type: Decision`文書では、領域固有のフィールド(`ydr_id`、`decision_status`など)を追加する。これらはOKF標準フィールドではなく、YAMORUプロジェクト固有の拡張であることに注意する。詳細は[2. YAMORUで使う`type`](#2-yamoruで使うtype)を参照。

`okf_version: "0.2"`は、バンドルの起点である`docs/index.md`だけに付けるフィールドで、個別文書には付けない。

上記はYAMORUで実際に使っているフィールドのみを挙げた最低限の一覧であり、OKF v0.2の全フィールドではない。仕様には他に`resource`、`sources`、`generated`、`verified`などの任意フィールドが定義されている。全体は公式SPECを参照する。

## 2. YAMORUで使う`type`

現時点で`docs/`配下に存在する`type`の例。新しい種類の文書を追加するときは、これらを参考に説明的な値を選ぶ。

| `type` | 用途 | 例 |
|---|---|---|
| `Decision` | 1件の意思決定を記録する文書(YDR) | `docs/decisions/ydr-001-family-first.md` |
| `Product Plan` | プロダクト構想・計画文書 | `docs/product/yamoru-project-plan.md` |
| `Playbook` | 手順・テンプレート集 | `docs/references/review-prompts.md`、本ガイド |

### 最小テンプレート: `type: Decision` (YDR)

意思決定を1件のOKF文書として追加するときの最小構成。既存文書は`docs/decisions/`配下、索引は`docs/decisions/index.md`を参照。

```markdown
---
type: Decision
ydr_id: YDR-XXX
title: (決定の要約を1文で)
description: (背景・対象・結論が分かる1文)
tags: [yamoru, decisions, ydr]
status: stable
decision_status: Accepted
decision_date: YYYY-MM-DD
---

# YDR-XXX: (決定の要約を1文で)

- 状態: Accepted
- 決定日: YYYY-MM-DD

## 背景

(なぜこの決定が必要になったか)

## 決定

(何を決めたか)

## 結果

(この決定によって何が変わるか)

## 見直す条件

(どうなったら見直すか)
```

既存のAcceptedな判断を置き換える場合は、置き換え元・置き換え先の両方に`supersedes` / `superseded_by`を設定し、`decision_status`をそれぞれ更新する。フィールドの詳細な使い方は`docs/decisions/ydr-007-notification-field-trial.md`(Superseded側)と`docs/decisions/ydr-009-drop-notifications-consolidate-home.md`(Accepted側)を参照。新規追加時は`docs/decisions/index.md`の一覧への追記も同じ変更内で行う。

## 3. `status`と領域固有の状態を混同しない

OKFの`status`は文書そのものの**ライフサイクル状態**(この文書は下書きか、確定しているか、廃止されたか)であり、`draft` / `stable` / `deprecated`の3値しか取らない。

一方、YAMORUの意思決定(YDR)には、決定そのものの**採否・置き換え状態**(Accepted / Superseded)という別の情報がある。これはOKFの`status`では表現できないため、`decision_status`という別フィールドに分ける。

```yaml
# 良い例: 文書のライフサイクルと決定の採否を別フィールドにする
status: stable            # この文書(YDR)自体は確定済みの記述
decision_status: Superseded  # ただし決定内容はYDR-009に置き換えられた
superseded_by: YDR-009
```

```yaml
# 悪い例: 決定の採否をOKFのstatusで表現しようとする
status: deprecated  # Accepted/Supersededのどちらの意味かが本文を読むまで分からない
```

`status: deprecated`は「この文書の記述をもう参照しなくてよい」ことを意味し、「この決定は置き換えられたが記録として有効」を意味しない。YDRの`status`は基本的に`stable`のまま保ち、決定の採否は`decision_status`(および`supersedes` / `superseded_by`)で表す。

この区別は`docs/decisions/index.md`のReading rulesにも明記されている。

## 4. 参照

- [Open Knowledge Format v0.2 SPEC](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) - 公式仕様
- [Decision knowledge](../decisions/index.md) - `type: Decision`文書の索引と現在有効な判断の読み方
- [レビュー依頼プロンプト](review-prompts.md) - `type: Playbook`の文書例
