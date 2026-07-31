import { MAIN_CONTENT_ID } from './constants';

/**
 * Skip-to-content link.
 *
 * Visually hidden until focused, so keyboard and screen-reader users can jump
 * past the navigation instead of tabbing through every item on every page.
 * It must be the first focusable element in the document, which is why it is
 * rendered at the top of the layout rather than inside the header.
 */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="bg-primary text-primary-foreground focus:ring-ring sr-only rounded-md px-4 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:ring-2 focus:ring-offset-2"
    >
      Skip to content
    </a>
  );
}
