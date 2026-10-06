import js from '@eslint/js'
import react from 'eslint-plugin-react'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  // Build output, generated demo reports, and test scratch dirs
  { ignores: ['dist/', 'coverage/', 'public/demo/', '**/.test-tmp*/'] },

  js.configs.recommended,

  // Dashboard: runs in the browser
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/scanner/**', 'src/**/__tests__/**'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Core no-unused-vars doesn't see JSX usage (<Dashboard />) in ESLint 9;
    // this rule marks those identifiers as used. Nothing else from the plugin.
    files: ['src/**/*.jsx'],
    plugins: { react },
    rules: { 'react/jsx-uses-vars': 'error' },
  },
  {
    files: ['src/**/*.jsx'],
    ...reactHooks.configs.flat['recommended-latest'],
  },
  {
    files: ['src/**/*.jsx'],
    ...reactRefresh.configs.vite,
  },

  // Scanner CLI, scripts, tests, and config files: run in Node
  {
    files: [
      'src/scanner/**/*.js',
      'src/**/__tests__/**/*.js',
      'scripts/**/*.js',
      '*.config.js',
    ],
    languageOptions: { globals: globals.node },
  },
]
