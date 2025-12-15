import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-plugin-prettier";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tsParser from "@typescript-eslint/parser";

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

export default defineConfig([globalIgnores([
  "src/Tests/*",
  "**/lib",
  "**/coverage",
  "**/*.lock",
  "**/.eslintrc.json",
  "src/WABinary/index.ts",
  "**/WAProto",
  "Example/Example.ts",
  "**/docs",
  "**/proto-extract",
]),
{
  extends: compat.extends("plugin:prettier/recommended"),

  plugins: {
    prettier,
    "@typescript-eslint": typescriptEslint as any,
    "simple-import-sort": simpleImportSort,
  },

  languageOptions: {
    globals: {},
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: "module",

    parserOptions: {
      project: "./tsconfig.json",
    },
  },

  rules: {
    "@typescript-eslint/no-misused-promises": ["error", {
      checksSpreads: true,
      checksVoidReturn: false,
      checksConditionals: true,
    }],
    "@typescript-eslint/prefer-optional-chain": ["error"],
    "@typescript-eslint/no-unnecessary-type-assertion": ["error"],
    "@typescript-eslint/no-unnecessary-type-constraint": ["error"],
    "@typescript-eslint/no-redundant-type-constituents": ["error"],
    "@typescript-eslint/no-inferrable-types": ["error"],
    "@typescript-eslint/no-explicit-any": ["warn", {
      ignoreRestArgs: true,
    }],
    "@typescript-eslint/no-unused-vars": ["error", {
      "argsIgnorePattern": "^_",
      "varsIgnorePattern": "^_",
      "caughtErrorsIgnorePattern": "^_"
    }],
    camelcase: ["off"],
    "no-console": ["warn"],
    "no-unneeded-ternary": ["error"],
    "no-constant-condition": ["error"],
    "no-constant-binary-expression": "error",
    curly: [2, "all"],

    "padding-line-between-statements": ["error", {
      blankLine: "always",
      prev: "function",
      next: "*",
    }, {
        blankLine: "always",
        prev: "block-like",
        next: "*",
      }, {
        blankLine: "always",
        prev: "import",
        next: "block-like",
      }],

    eqeqeq: "error",
    "func-names": ["error", "never"],
    "prefer-const": "error",
    "no-unused-vars": "off",
    "simple-import-sort/imports": ["error", {
      groups: [[
        "^@?\\w",
        "^(components|modules|utils)(/.*|$)",
        "^\\u0000",
        "^\\.\\.(?!/?$)",
        "^\\.\\./?$",
        "^\\./(?=.*/)(?!/?$)",
        "^\\.(?!/?$)",
        "^\\./?$",
        "^(.*)$",
      ]],
    }],
  },
}]);
