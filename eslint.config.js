const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        ignores: ['.opencode/dist/**', '.cursor/**', 'node_modules/**', '.venv/**', 'venv/**', 'coverage/**', 'workflows/**/*.workflow.*', '.claude/workflows/**', 'apps/bank-battle-live/lib/vendor-qr/**']
    },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.es2022
            }
        },
        rules: {
            'no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_'
            }],
            'no-undef': 'error',
            'eqeqeq': 'warn',
            'prefer-const': 'warn',
            'no-var': 'warn',
            'no-console': 'off',
            'complexity': ['warn', 20],
            'max-depth': ['warn', 5],
            'max-params': ['warn', 6]
        }
    },
    {
        files: ['**/*.mjs'],
        languageOptions: {
            sourceType: 'module'
        }
    },
    {
        // Standalone Vercel app (ESM, "type": "module"); its public/ scripts run in the browser.
        files: ['apps/bank-battle-live/**/*.js'],
        languageOptions: {
            sourceType: 'module'
        }
    },
    {
        files: ['apps/bank-battle-live/public/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.browser
            }
        }
    },
    {
        files: ['docker/context-profiles/complex-eval/**/recurring-incident/**/*.js'],
        languageOptions: {
            sourceType: 'module'
        }
    }
];
