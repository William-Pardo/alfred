import js from "@eslint/js";

export default [
  { ignores: ["node_modules/**", "dist/**", "alfred/**"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off"
    }
  }
];