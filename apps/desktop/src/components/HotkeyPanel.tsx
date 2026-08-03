import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { Keyboard } from "lucide-react";

import { useT } from "../features/i18n/store";
import type { HotkeyErrors } from "../overlay/bridge";
import {
  HOTKEY_ACTIONS,
  type HotkeyAction,
  type HotkeySettings,
} from "../overlay/model";

type HotkeyPanelProps = {
  hotkeys: HotkeySettings;
  registrationErrors: HotkeyErrors;
  onSave: (hotkeys: HotkeySettings) => void;
};

export function HotkeyPanel({
  hotkeys,
  registrationErrors,
  onSave,
}: HotkeyPanelProps) {
  const [draft, setDraft] = useState(hotkeys);
  const [localErrors, setLocalErrors] = useState<HotkeyErrors>({});
  const [saved, setSaved] = useState(false);
  const t = useT();

  useEffect(() => {
    setDraft(hotkeys);
  }, [hotkeys]);

  const errors = useMemo(
    () => ({ ...registrationErrors, ...localErrors }),
    [localErrors, registrationErrors],
  );

  function updateDraft(action: HotkeyAction, value: string) {
    setDraft((current) => ({ ...current, [action]: value }));
    setSaved(false);
    setLocalErrors((current) => {
      const next: HotkeyErrors = {};
      for (const item of HOTKEY_ACTIONS) {
        const currentError = current[item.action];
        if (item.action !== action && currentError !== undefined) {
          next[item.action] = currentError;
        }
      }
      return next;
    });
  }

  function handleSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const nextErrors: HotkeyErrors = {};
    const used = new Map<string, HotkeyAction>();

    for (const { action } of HOTKEY_ACTIONS) {
      const shortcut = draft[action].trim();
      const normalized = shortcut.toLocaleLowerCase();

      if (!shortcut.includes("+")) {
        nextErrors[action] = t("hotkeyNeedsModifier");
        continue;
      }

      const duplicate = used.get(normalized);
      if (duplicate !== undefined) {
        nextErrors[action] = t("hotkeyDuplicate");
      } else {
        used.set(normalized, action);
      }
    }

    setLocalErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) {
      onSave(draft);
      setSaved(true);
    }
  }

  return (
    <details className="settings-disclosure">
      <summary>
        <span className="summary-icon" aria-hidden="true">
          <Keyboard size={18} />
        </span>
        <span>
          <strong>{t("settingsGlobalHotkeys")}</strong>
        </span>
      </summary>

      <form className="hotkey-form" onSubmit={handleSubmit} noValidate>
        {HOTKEY_ACTIONS.map(({ action, labelKey }) => {
          const error = errors[action];
          const errorId = `hotkey-${action}-error`;
          return (
            <div className="field" key={action}>
              <label htmlFor={`hotkey-${action}`}>{t(labelKey)}</label>
              <input
                id={`hotkey-${action}`}
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={draft[action]}
                aria-invalid={error === undefined ? undefined : true}
                aria-describedby={error === undefined ? undefined : errorId}
                onChange={(event) => {
                  updateDraft(action, event.currentTarget.value);
                }}
              />
              {error !== undefined && (
                <p className="field-error" id={errorId}>
                  {error}
                </p>
              )}
            </div>
          );
        })}

        <div className="form-actions">
          <button className="button secondary" type="submit">
            {t("settingsSaveHotkeys")}
          </button>
          {saved && (
            <span className="save-confirmation" role="status">
              {t("settingsSavedLocally")}
            </span>
          )}
        </div>
      </form>
    </details>
  );
}
