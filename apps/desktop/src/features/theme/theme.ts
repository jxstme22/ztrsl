import { z } from "zod";

/**
 * App theme selection.
 *
 * `dark` is the default liquid-glass look. `light` keeps the same transparent
 * glass surfaces (acrylic frost, backdrop blur, translucent panels) with a
 * light tint and dark text. The choice is stored in localStorage so the next
 * launch opens with the same theme.
 */

export const appThemeSchema = z.enum(["dark", "light"]);
export type AppTheme = z.infer<typeof appThemeSchema>;

export const DEFAULT_APP_THEME: AppTheme = "dark";
