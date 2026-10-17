// 外部クライアントからの要求を処理する主体(docs/product/conversation-integration.md
// 3節)。検証済みのaccess tokenからだけ作り、要求本文に書かれた利用者IDや
// 家庭IDを採用しない。家庭IDは接続時に固定した値で、現在の所属も確認済み。

import type { IntegrationScope } from "./scopes";

export type IntegrationPrincipal = {
  clientId: string;
  connectionId: string;
  householdId: string;
  scopes: readonly IntegrationScope[];
  userId: string;
};
