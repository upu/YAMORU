// Issue #116: Cloudflare Workers移行可否スパイク用の設定。
// R2による永続キャッシュはリモートリソース作成が必要になるため、
// このスパイクではデフォルト(インメモリ)のままにする。
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
