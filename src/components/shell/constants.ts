/**
 * The id the skip link targets and `<main>` carries. Shared so the two can
 * never drift apart — a skip link pointing at a missing id fails silently,
 * and only for the users who depend on it.
 */
export const MAIN_CONTENT_ID = 'main-content';
