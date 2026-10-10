/**
 * Light or dark theme. The Viewer's choice is remembered in this browser;
 * before they choose, the device's preference picks the starting theme.
 * Applied before paint by the inline script in __root.tsx (THEME_BOOT), so
 * a dark-mode Viewer never sees a light flash.
 */

export type Theme = 'light' | 'dark'

const THEME_KEY = 'budgy.theme'

export function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

const THEME_COLORS: Record<Theme, string> = {
  light: '#f6f5f1',
  dark: '#101312',
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Storage unavailable (private mode): the choice lasts for this page.
  }
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[theme])
}

/** Runs inline in <head> before first paint. */
export const THEME_BOOT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})();`

/**
 * Runs inline right after the head's meta tags: match theme-color (which
 * colors the iOS status bar and browser chrome) to the theme already set.
 */
export const THEME_COLOR_BOOT = `(function(){try{var m=document.querySelector('meta[name="theme-color"]');if(m&&document.documentElement.classList.contains('dark'))m.setAttribute('content','${THEME_COLORS.dark}')}catch(e){}})();`
