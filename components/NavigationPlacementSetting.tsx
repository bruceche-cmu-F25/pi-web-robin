"use client";

import { useId } from "react";
import { useI18n } from "@/hooks/useI18n";
import { setNavigationPlacement, useNavigationPlacement } from "@/hooks/useNavigationPlacement";

/** The same browser preference in Chat's General settings and Robin's Settings page. */
export function NavigationPlacementSetting() {
  const { t } = useI18n();
  const placement = useNavigationPlacement();
  const id = useId();
  return (
    <div>
      <div className="settings-chat-options">
        <div className="settings-chat-option settings-chat-switch-option" style={{ flexWrap: "wrap" }} role="radiogroup"
          aria-label={t("settings.navigationPlacement")} aria-describedby={`${id}-description`}>
          <span>{t("settings.navigationPlacement")}</span>
          <div className="settings-send-mode-options settings-navigation-options">
            {([
              ["left", "settings.navigationLeft"],
              ["left-labels", "settings.navigationLeftLabels"],
              ["top", "settings.navigationTop"],
              ["top-icons", "settings.navigationTopIcons"],
            ] as const).map(([value, label]) => (
              <label key={value} className="settings-send-mode-option">
                <input type="radio" name={id} value={value} checked={placement === value}
                  onChange={() => setNavigationPlacement(value)} className="sr-only" />
                <span className="settings-send-mode-label">{t(label)}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <p id={`${id}-description`} className="settings-general-description">{t("settings.navigationPlacementDescription")}</p>
    </div>
  );
}
