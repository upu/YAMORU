# Components

変更する機能を選び、その文書で実装・テスト・関連YDRの入口を確認する。

## Reading rules

- この表から対象機能だけを開き、変更内容に対応する実装・テストを読む。入口から先はコードのimportをたどる。
- 詳細な処理対応表は各機能の文書へ置く。正本の複製や全関数一覧は作らない。
- 意思決定は各YDRの`decision_status`と置き換え範囲を確認し、`Accepted`かつ置き換えられていない判断だけを使う([Decision knowledge](../decisions/index.md))。
- データベースへ影響する変更は[変更手順](../references/database-change-playbook.md)に従う。
- コードを移動したら、同じPRで該当する機能文書を更新する。共通索引は機能の入口が変わるときに更新する。

## 対応表

| 変更したい機能 | 実装・テスト・詳細文書への入口 |
|---|---|
| ホーム・期限や推奨期間の表示 | [ホーム](home.md) |
| Todoの登録・編集・完了・担当・予定計算 | [Todo](todos.md) |
| 台帳の登録・分類・タグ・AI提案 | [台帳](managed-items.md) |
| 消耗品の在庫・履歴・補充・関連・ピン留め | [消耗品](consumables.md) |
| 横断検索・一覧の絞り込み | [検索](search.md) |
| ログイン・家庭・招待・家庭間分離 | [認証・家庭・招待](household-access.md) |
| 追加・戻る導線・ヘルプ・画面の見た目 | [スタイル](styles.md) |
| 外部接続の導入・復旧・OAuth・接続管理・変更操作 | [外部連携](integration.md) |
| 会話向けの検索・詳細・履歴 | [会話読み取り](conversation-read.md) |
| MCPのHTTP入口・Tool定義・接続確認 | [MCP](mcp.md) |
| 本人の通知設定・履歴・通知への返答 | [個人の通知](notifications.md)、[通知への返答](notification-replies.md) |
| 通知候補・定期取得・送信と再試行・通信部品 | [通知候補](attention.md)、[通知outbox・定期走査](notification-outbox.md) |

## まだ実装していない領域

会話向けの共通読み取り(#435)、通知候補生成(#440)、本人の設定と履歴(#441)、認可と接続管理(#436)、実装済みcommand(#437/#438)、認証付きMCP入口(#439)は上の表に入口を示す。許可するclient_idを設定するまで外部受付は無効である。実dotとの接続実証・追加の変更操作・実際の配信は[会話連携設計](../product/conversation-integration.md)に契約と合格条件を定義している。MCP入口の実装やローカルSDKの成功は、実dotとの接続や通知の到達を証明しない。

Documents(ファイル添付)、Payments、Replacementは[YDR-003](../decisions/ydr-003-defer-inventory-attachments-payments-replacement.md)により後続Phaseとし、現時点で対応する実装を持たない。同YDRで「独立したPhaseとして追加する」とした在庫は、消耗品として実装済みであり[消耗品](consumables.md)で扱う。
