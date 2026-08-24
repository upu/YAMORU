import { fileURLToPath } from "node:url";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

const tsconfigRootDir = fileURLToPath(new URL(".", import.meta.url));

const commonTypeScriptRules = {
  complexity: ["error", 15],
  // 分岐の「数」はcomplexityで、分岐の「入れ子の深さ」による読みにくさは
  // cognitive-complexityで別軸に検知する。
  "sonarjs/cognitive-complexity": ["error", 10],
  "max-depth": ["error", 3],
  // 理由を説明するコメントを厚くしても関数長として罰しない。
  "max-lines-per-function": [
    "error",
    { max: 60, skipBlankLines: true, skipComments: true },
  ],
};

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { sonarjs },
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
    rules: commonTypeScriptRules,
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      // suite全体を表すコールバックは実コードより長くなりやすいため、テストだけ緩和する。
      "max-lines-per-function": [
        "error",
        { max: 200, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    // D1統合テストはWorkersランタイム専用のconfig/vitest.d1.config.tsでのみ実行され、
    // "cloudflare:workers"のような
    // Workers組み込みモジュールを使うためtsconfig.json(DOM libを使う既存app用)の
    // 型検査対象から意図的に除外している(判明した制約としてdocs/spikes/参照)。
    // そのため型情報を要求するprojectServiceの対象からも外す。
    files: ["src/lib/d1/**/*.d1-test.ts"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "max-lines-per-function": [
        "error",
        { max: 200, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "coverage/**",
    ".claude/worktrees/**",
    // opennextjs-cloudflare buildとwrangler devが出力する
    // バンドル済みWorkerスクリプト・ローカルD1状態(生成物)。
    ".open-next/**",
    ".wrangler/**",
    "d1/.wrangler-state/**",
  ]),
]);
