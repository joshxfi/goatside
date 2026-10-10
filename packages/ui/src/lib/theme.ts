/**
 * Inline script for <head>: applies the `dark` class from the system
 * setting before first paint (no flash), and follows later changes.
 */
export const THEME_SCRIPT = `(() => {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement.classList.toggle("dark", mq.matches);
  apply();
  mq.addEventListener("change", apply);
})()`
