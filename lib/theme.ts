export type Theme = "light" | "dark";

export const THEME_COOKIE_KEY = "text-diff-tool-theme";

export function isTheme(value: string | null | undefined): value is Theme {
  return value === "light" || value === "dark";
}
