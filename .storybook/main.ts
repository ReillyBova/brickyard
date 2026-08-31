import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Vite/React/TypeScript Storybook config for BrickYard's `src/ui/` slice.
 * Deliberately does not read the app's `vite.config.ts` (that file is outside this
 * slice's ownership) — the framework preset supplies its own React + TS handling, and
 * `preview.tsx` imports the design system's CSS directly.
 */
const config: StorybookConfig = {
  stories: ['../src/ui/**/*.mdx', '../src/ui/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
};

export default config;
