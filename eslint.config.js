import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier/flat';

const forbidLayers = (files, layers) => ({
  files,
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: layers.map((layer) => ({
          group: [`**/${layer}/**`],
          message: `This layer must not import ${layer}/.`,
        })),
      },
    ],
  },
});

export default tseslint.config(
  { ignores: ['node_modules', 'data', 'graphify-out', 'src/generated'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  forbidLayers(
    ['src/domain/**'],
    ['application', 'infrastructure', 'presentation', 'config', 'generated'],
  ),
  forbidLayers(['src/application/**'], ['infrastructure', 'presentation', 'config', 'generated']),
  forbidLayers(['src/infrastructure/**'], ['presentation']),
  forbidLayers(['src/presentation/**'], ['infrastructure', 'config', 'generated']),
);
