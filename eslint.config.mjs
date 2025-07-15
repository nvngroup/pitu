// eslint.config.mjs
import { createRequire } from "module";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "./prettier.config.mjs";
import importPlugin from "eslint-plugin-import";
import simpleImportSort from "eslint-plugin-simple-import-sort";

const require = createRequire(import.meta.url);

export default [
  importPlugin.flatConfigs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.json"
      }
    },
    plugins: {
      "@typescript-eslint": typescriptEslint,
      prettier: prettier,
      "simple-import-sort": simpleImportSort
    },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "simple-import-sort/imports": "warn",
      "simple-import-sort/exports": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "_" }],
      "import/prefer-default-export": "off",
      "no-console": "warn",
      "no-param-reassign": "off",
      "import/extensions": ["error", "ignorePackages", { ts: "never" }],
      quotes: [1, "double", { avoidEscape: true }],
      "prettier/prettier": [
        "error",
        {
          ...prettierConfig,
          singleQuote: false,
          trailingComma: "none",
          arrowParens: "avoid",
          semi: false
        }
      ]
    },
    settings: {
      "import/resolver": {
        typescript: {}
      }
    }
  }
];
