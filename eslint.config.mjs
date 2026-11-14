import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    "dist/**",
    ".vinext/**",
    ".wrangler/**",
    ".sites-runtime/**",
    "outputs/**",
    "work/**",
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // これらのファイルは shadcn@4.17.0 から取り込み、コメントを日本語化したもの。
      // 上流と挙動を揃えつつ、Site のコードにはより厳しいルールを適用する。
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
