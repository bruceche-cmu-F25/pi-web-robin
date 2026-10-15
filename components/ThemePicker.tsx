"use client";

import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { THEME_OPTIONS } from "@/lib/theme";

/** Shared by Pi Web and Robin settings; both expose the complete palette catalog. */
export function ThemePicker() {
  const { t } = useI18n();
  const { preference, setThemePreference } = useTheme();
  return (
    <div role="radiogroup" aria-label={t("settings.appearance")} className="settings-theme-options">
      {THEME_OPTIONS.map((option) => (
        <label key={option.id} className="settings-theme-option"
          data-system={option.id === "auto" || undefined}
          data-wide={option.id === "contrast-light" || option.id === "contrast-dark" || option.id === "zenburn" || undefined}>
          <input type="radio" name="theme" value={option.id} checked={preference === option.id}
            onChange={() => setThemePreference(option.id)} className="sr-only" />
          {option.id === "auto" ? (
            <span className="settings-theme-swatch settings-theme-system" aria-hidden="true">
              <span data-theme="light" className="settings-theme-chip" />
              <span data-theme="dark" className="settings-theme-chip" />
              <span className="settings-theme-system-name">{t(option.label)}</span>
            </span>
          ) : (
            <span className="settings-theme-swatch" aria-hidden="true">
              <span data-theme={option.id} className="settings-theme-fill">
                <span className="settings-theme-name">{t(option.label)}</span>
              </span>
            </span>
          )}
          <span className="sr-only">{t(option.label)}</span>
        </label>
      ))}
    </div>
  );
}
