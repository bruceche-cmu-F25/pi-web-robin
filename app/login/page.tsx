"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import { safeLoginDestination } from "@/lib/login-destination";

function safeDestination(): string {
  const destination = new URLSearchParams(window.location.search).get("next");
  return safeLoginDestination(destination, window.location.origin);
}

function LoginForm() {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The input is disabled while a login is in flight, which drops focus;
  // hand it back so a wrong password can be retyped straight away.
  useEffect(() => {
    if (!busy && error) inputRef.current?.select();
  }, [busy, error]);

  const failureMessage = async (response: Response): Promise<string> => {
    if (response.status === 401) return t("auth.invalidPassword");
    if (response.status !== 429) return t("auth.loginFailed");
    const seconds = Number(response.headers.get("retry-after"));
    return t("auth.tooManyAttempts", { seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 1 });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/web-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError(await failureMessage(response));
        return;
      }
      window.location.replace(safeDestination());
    } catch {
      setError(t("auth.loginFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="web-login-page">
      <div className="web-login-card">
        <header className="web-login-brand">
          <Image src="/icons/apple-touch-icon.png" width={48} height={48} alt="" priority />
          <h1>Pi Web</h1>
          <p>{t("auth.prompt")}</p>
        </header>
        <form className="web-login-form" onSubmit={submit} noValidate>
          <label className="web-login-label" htmlFor="web-login-password">{t("auth.password")}</label>
          <div className="web-login-field" data-invalid={error ? "true" : undefined}>
            <input
              ref={inputRef}
              id="web-login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("auth.passwordPlaceholder")}
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              required
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby="web-login-error"
            />
            <button
              type="button"
              className="web-login-reveal"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
              aria-pressed={showPassword}
              title={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
                {showPassword ? null : <line x1="4" y1="20" x2="20" y2="4" />}
              </svg>
            </button>
          </div>
          <p id="web-login-error" className="web-login-error" role="alert" aria-live="polite">{error}</p>
          <button type="submit" className="web-login-submit" disabled={busy || !password}>
            {busy ? t("auth.loggingIn") : t("auth.logIn")}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <I18nProvider><LoginForm /></I18nProvider>;
}
