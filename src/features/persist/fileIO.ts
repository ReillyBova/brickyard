/**
 * Browser file I/O: a save-as download and an open-file picker. Ordinary web APIs — a
 * `Blob` URL behind a synthetic `<a download>` click, and a hidden `<input type=file>`
 * driven programmatically — nothing here needs Node or a server. Not unit-tested: it's a
 * thin wrapper over DOM APIs vitest doesn't run against (`environment: 'node'`, see
 * `vite.config.ts`); it's exercised in-browser instead.
 */

export function downloadText(filename: string, contents: string, mimeType = 'application/json'): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Deferred: revoking synchronously can race the click-triggered download in some
    // browsers.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Opens the browser's file picker restricted to `accept` and resolves with the chosen
 * file's text, or `undefined` if the user dismissed the dialog. One picker per call: the
 * input element is created, used once, and discarded rather than kept around.
 */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';

    // There's no dismiss event for a native file dialog; `focus` returning to the page
    // without a `change` having fired is the standard way to detect a cancel.
    const cleanup = () => {
      window.removeEventListener('focus', onFocus);
      input.remove();
    };
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) {
          cleanup();
          resolve(undefined);
        }
      }, 300);
    };

    input.addEventListener('change', () => {
      window.removeEventListener('focus', onFocus);
      const file = input.files?.[0];
      if (!file) {
        cleanup();
        resolve(undefined);
        return;
      }
      void file.text().then((text) => {
        cleanup();
        resolve({ name: file.name, text });
      });
    });

    window.addEventListener('focus', onFocus);
    document.body.appendChild(input);
    input.click();
  });
}
