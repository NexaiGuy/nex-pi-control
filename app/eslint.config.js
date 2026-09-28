// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { files: ['__tests__/**', 'jest.setup.js'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  { ignores: ['dist/*', 'android/*', 'src/features/terminal/xtermHtml.ts', 'scripts/*'] },
]);
