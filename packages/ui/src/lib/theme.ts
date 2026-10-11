import { useSyncExternalStore } from "react"

/**
 * Light, dark, or the device's setting. The choice is per device, kept in
 * localStorage; "system" is stored as nothing at all.
 */
export type Theme = "light" | "dark" | "system"

export const THEMES: readonly Theme[] = ["light", "dark", "system"]

const STORAGE_KEY = "goatside:theme"

/** Browser and installed-app chrome (theme-color), per resolved theme. */
const CHROME = { light: "#f7f5f0", dark: "#0f0e0c" } as const

/**
 * Inline script for <head>: applies the saved theme, or the system's, before
 * first paint (no flash), and keeps following the system while on "system".
 * A theme chosen in another tab applies here too. Mirrors `apply` below.
 */
export const THEME_SCRIPT = `(() => {
  const key = ${JSON.stringify(STORAGE_KEY)};
  const chrome = ${JSON.stringify(CHROME)};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const read = () => {
    try {
      const t = localStorage.getItem(key);
      return t === "light" || t === "dark" ? t : "system";
    } catch (e) {
      return "system";
    }
  };
  const apply = () => {
    const theme = read();
    const dark = theme === "dark" || (theme === "system" && mq.matches);
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
    let meta = document.getElementById("theme-color-override");
    if (theme === "system") {
      if (meta) meta.remove();
      return;
    }
    if (!meta) {
      meta = document.createElement("meta");
      meta.id = "theme-color-override";
      meta.name = "theme-color";
      document.head.prepend(meta);
    }
    meta.content = dark ? chrome.dark : chrome.light;
  };
  apply();
  mq.addEventListener("change", apply);
  window.addEventListener("storage", (e) => { if (e.key === key) apply(); });
})()`

function read(): Theme {
  try {
    const theme = localStorage.getItem(STORAGE_KEY)
    return theme === "light" || theme === "dark" ? theme : "system"
  } catch {
    return "system"
  }
}

/**
 * Puts `theme` on the page: the `dark` class, the native color scheme, and a
 * theme-color ahead of the per-scheme ones in <head>, so the status bar
 * matches a theme that differs from the system's.
 */
function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  const root = document.documentElement
  root.classList.toggle("dark", dark)
  root.style.colorScheme = dark ? "dark" : "light"

  const existing = document.getElementById("theme-color-override")
  if (theme === "system") {
    existing?.remove()
    return
  }
  const meta =
    existing instanceof HTMLMetaElement
      ? existing
      : Object.assign(document.createElement("meta"), {
          id: "theme-color-override",
          name: "theme-color",
        })
  if (!meta.isConnected) document.head.prepend(meta)
  meta.content = dark ? CHROME.dark : CHROME.light
}

const listeners = new Set<() => void>()

/** Switches the theme on this device, without every color fading across. */
export function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Private mode: the theme still applies until the page closes.
  }
  const still = document.createElement("style")
  still.textContent = "*,*::before,*::after{transition:none!important}"
  document.head.append(still)
  apply(theme)
  // Styles must recalculate before transitions come back.
  void window.getComputedStyle(document.body).opacity
  requestAnimationFrame(() => still.remove())
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

/** The chosen theme. The server, which can't know it, renders "system". */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => "system")
}
