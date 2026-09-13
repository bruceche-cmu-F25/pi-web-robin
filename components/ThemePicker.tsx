"use client";

import { useI18n } from "@/hooks/useI18n";
import { useTheme, type ThemePreference } from "@/hooks/useTheme";

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "light") {
    return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.41M17.66 6.34l1.41-1.41" /></svg>;
  }
  if (preference === "dark") {
    return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>;
  }
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
}

/** The single direct light/dark/system selector shared by both settings surfaces. */
export function ThemePicker() {
  const { t } = useI18n();
  const { preference, setThemePreference } = useTheme();
  const options: { id: ThemePreference; label: string }[] = [
    { id: "light", label: t("settings.themeLight") },
    { id: "dark", label: t("settings.themeDark") },
    { id: "auto", label: t("settings.themeSystem") },
  ];

  return (
    <div role="radiogroup" aria-label={t("settings.appearance")} className="settings-theme-options">
      {options.map((option) => {
        const selected = preference === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setThemePreference(option.id)}
            className="settings-theme-option"
          >
            <ThemeIcon preference={option.id} />
            <span className="settings-theme-option-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
