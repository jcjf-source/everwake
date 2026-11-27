/**
 * Visible error reporting.
 *
 * Errors are never swallowed: caught errors reported here are also passed to
 * console.error, and the browser's own uncaught-error logging is left intact
 * (no preventDefault). The panel makes failures obvious on devices without an
 * open console (e.g. phones).
 */

const MAX_VISIBLE_ERRORS = 10;

/**
 * Turn any thrown value / rejection reason into a displayable record.
 * Pure function — unit tested.
 * @param {unknown} value
 * @param {string} [context] where the error came from (e.g. "Uncaught error")
 * @returns {{ message: string, detail: string }}
 */
export function formatError(value, context = 'Error') {
  let message;
  let detail = '';

  if (value instanceof Error) {
    message = `${value.name}: ${value.message}`;
    detail = value.stack || '';
  } else if (typeof value === 'string') {
    message = value;
  } else if (value === undefined || value === null) {
    message = `${String(value)} was thrown`;
  } else {
    try {
      message = JSON.stringify(value) ?? String(value);
    } catch {
      message = String(value);
    }
  }

  return { message: `${context}: ${message}`, detail };
}

/**
 * Install global handlers and wire the on-page error panel.
 * @param {{ panel: HTMLElement, list: HTMLElement, dismiss: HTMLElement }} elements
 * @param {Window} [win]
 * @returns {(value: unknown, context?: string) => void} report function for caught errors
 */
export function installErrorReporter(elements, win = window) {
  const { panel, list, dismiss } = elements;
  const doc = win.document;

  function show({ message, detail }) {
    const item = doc.createElement('li');
    const text = doc.createElement('div');
    text.textContent = message;
    item.appendChild(text);
    if (detail) {
      const pre = doc.createElement('pre');
      pre.textContent = detail;
      item.appendChild(pre);
    }
    list.appendChild(item);
    while (list.children.length > MAX_VISIBLE_ERRORS) {
      list.removeChild(list.firstElementChild);
    }
    panel.hidden = false;
  }

  function report(value, context = 'Error') {
    console.error(`[Everwake] ${context}`, value);
    show(formatError(value, context));
  }

  win.addEventListener('error', (event) => {
    // The browser logs uncaught errors itself; we only surface them on screen.
    const value = event.error ?? event.message ?? 'Unknown error';
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : '';
    show(formatError(value, `Uncaught error${where}`));
  });

  win.addEventListener('unhandledrejection', (event) => {
    show(formatError(event.reason, 'Unhandled promise rejection'));
  });

  dismiss.addEventListener('click', () => {
    panel.hidden = true;
    list.replaceChildren();
  });

  return report;
}
