import { fileURLToPath } from "node:url";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const tsconfigRootDir = fileURLToPath(new URL(".", import.meta.url));

const commonTypeScriptRules = {
  complexity: ["error", 15],
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
  globalIgnores([
    ".next/**",
    "out/**",
    "coverage/**",
    ".claude/worktrees/**",
    // Supabase CLIが出力する生成物(Issue #45)。手で直せないため整形規則の
    // 対象外とする。型としての正しさはnpm run typecheckが引き続き検査する。
    "lib/supabase/database.types.ts",
  ]),
]);
