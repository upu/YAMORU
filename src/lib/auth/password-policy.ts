export const MIN_PASSWORD_LENGTH = 8;

/**
 * Cloudflare Workers上のcrypto.subtle.deriveBits()とnode:crypto pbkdf2()は、
 * どちらもPBKDF2の反復回数を100,000回までしか受け付けない
 * (NotSupportedError: "iteration counts above 100000 are not supported")。
 * この上限はWeb Crypto固有ではなくworkerdランタイム全体の制約で、
 * nodejs_compatを有効にしても回避できない。
 * ローカルのvitest実行やlocal `wrangler dev`(non-remote)のworkerdはこの上限を
 * 再現しないため、実機相当の検証は`wrangler dev --remote`でのみ確認できる
 * (Issue #142、2026-08-22に実機で確認)。
 * この定数を100,000より大きくすると、ローカルのテストは通っても
 * Cloudflare Workers上のログインが例外で失敗する。
 * 参照: https://github.com/cloudflare/workerd/issues/1346
 */
export const PASSWORD_HASH_ITERATIONS = 100_000;
