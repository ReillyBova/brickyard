import type { Decorator, Preview } from '@storybook/react-vite';

import '../src/styles/tokens.css';
import '../src/styles/components.css';

/**
 * Theme toggle. docs/DESIGN.md: theme is set with `data-theme` on `<html>`, never a
 * media query alone and never per component — so the decorator sets it on the iframe's
 * own document root rather than on a wrapper div, to match how the real app themes
 * itself. Dark is the app's default (see `index.html`), so it's the default here too.
 */
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--by-canvas)',
        color: 'var(--by-text)',
        fontFamily: 'var(--by-font-ui)',
        fontSize: 'var(--by-text-md)',
        padding: 'var(--by-space-6)',
        boxSizing: 'border-box',
      }}
    >
      <Story />
    </div>
  );
};

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    options: {
      storySort: {
        order: ['Foundations', 'PartsChest', 'ColorPicker', 'AppShell', '*'],
      },
    },
    a11y: {
      // Report only — component implementations are outside this slice's ownership.
      test: 'todo',
    },
  },
  globalTypes: {
    theme: {
      description: 'BrickYard theme',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'dark', icon: 'moon', title: 'Dark' },
          { value: 'light', icon: 'sun', title: 'Light' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'dark',
  },
  decorators: [withTheme],
};

export default preview;
