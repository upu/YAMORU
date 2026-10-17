---
type: Decision
ydr_id: YDR-053
title: 会話読み取りのrevisionを家庭世代で保守的に管理する
description: 旧Worker互換を先行配備し、DBトリガーによる世代と上限付き読み取りを導入する
tags: [yamoru, decisions, d1, integration]
status: stable
decision_status: Accepted
decision_date: 2026-10-17
---

# YDR-053: 会話読み取りのrevisionを家庭世代で保守的に管理する

[YDR-049](ydr-049-conversation-command-boundary.md)の共通読み取り・revision契約を#435で具体化する。既存のAccepted判断を置き換えない。OAuthのYDR-052は並行する#449の担当。

## 決定

家庭ごとにepochと単調増加versionを持ち、対象と関係・履歴・別名・所属のINSERT/UPDATE/DELETEをトリガーで捕捉する。対象種別とIDも含めたrevisionを返す。名前だけ戻すABA更新、同時刻の編集、旧Web/Workerによる変更も世代が進む。無関係な家庭内変更でも再取得を求める保守的方式であり、後続#437はこの世代を原子的なcommit条件へ含める。家庭Bの変更は家庭Aの世代を進めない。

D1実行結果のmeta.changesにはトリガーの変更件数が含まれることを実D1テストで確認した。既存の「最大一行を変更するSQLのmeta.changes===1」という成功判定を維持したままrevisionトリガーを追加すると、書き込みが成功しても競合エラーになる。このため#450で最大一行の更新は0件拒否とする互換Workerを先行配備し、その配備確認後に0032を適用する。単一リリースにまとめてmigrationを先行させない。0032適用後のロールバック先も互換Worker以降に限定する。

別名は対象と家庭を複合FKで束縛し、削除に追従する追加表とする。DBから一回に取得する行数を制限した上でUnicode正規化し、継続cursorを返す。古いWorkerが更新しないアプリ専用の検索索引は採用しない。空ページでも継続があれば検索途中であると明示する。

## 配備・検証・見直し

4状態、上限、公開範囲、接続方法は[読み取りComponent](../components/conversation-read.md)を参照。既存データは変換せず、追加表・triggerは恒久利用するためcontractは不要。

家庭規模が増えて候補走査のページ数や保守的な競合が利用を妨げる場合は、旧Writerの更新を取りこぼさない索引と対象別世代を新たに設計する。内容hashやupdated_atだけを変更系のrevisionへ代用しない。
