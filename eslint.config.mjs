import obsidianmd from 'eslint-plugin-obsidianmd';

export default [
    ...obsidianmd.configs.recommended,
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                projectService: true,
            },
        },
        rules: {
            // Community review reports these existing type-safety issues as warnings.
            // Keep them visible while making the review-blocking style rule an error.
            '@typescript-eslint/no-unsafe-assignment': 'warn',
            '@typescript-eslint/no-unsafe-member-access': 'warn',
            '@typescript-eslint/no-unsafe-return': 'warn',
            '@typescript-eslint/no-unsafe-argument': 'warn',
            '@typescript-eslint/no-unsafe-call': 'warn',
            '@typescript-eslint/no-this-alias': 'warn',
            '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
            '@typescript-eslint/unbound-method': 'warn',
            'no-useless-escape': 'warn',
            'no-control-regex': 'warn',
            'no-empty': 'warn',
            'obsidianmd/no-static-styles-assignment': 'error',
        },
    },
];
