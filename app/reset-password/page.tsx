"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, CheckCircle } from "lucide-react";
import AuthLayout from "@/components/auth/AuthLayout";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordRules = useMemo(
    () => [
      {
        label: "At least 8 characters",
        valid: password.length >= 8,
      },
      {
        label: "At least 1 uppercase letter",
        valid: /[A-Z]/.test(password),
      },
      {
        label: "At least 1 number",
        valid: /\d/.test(password),
      },
      {
        label: "At least 1 special character",
        valid: /[^A-Za-z0-9]/.test(password),
      },
    ],
    [password]
  );

  const isPasswordStrong =
    passwordRules.every((rule) => rule.valid);

  const handleSubmit = async (
    e: React.FormEvent
  ) => {
    e.preventDefault();

    setError("");

    if (!token) {
      setError("Missing reset token.");
      return;
    }

    if (!isPasswordStrong) {
      setError(
        "Please meet all password requirements."
      );
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(
        "/api/auth/reset-password",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token,
            password,
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        setError(
          data.error ||
            "Something went wrong."
        );
        return;
      }

      setSuccess(true);
    } catch (error) {
      console.error(
        "RESET_PASSWORD_CLIENT_ERROR:",
        error
      );

      setError(
        "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-8 text-center lg:text-left">
        <h1 className="text-2xl font-semibold text-white">
          {success ? "Password updated" : "Create a new password"}
        </h1>

        <p className="mt-1.5 text-sm text-slate-400">
          {success
            ? "Your password has been reset successfully."
            : "Choose a strong new password for your StudyMate AI account."}
        </p>
      </div>

      {success ? (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
            <CheckCircle size={24} className="text-emerald-400" />
          </div>

          <Link
            href="/login"
            className="inline-block h-11 rounded-xl bg-blue-600 px-6 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            Back to login
          </Link>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-3.5"
        >
          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm text-slate-300">
              New password
            </label>

            <div className="relative">
              <input
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                value={password}
                onChange={(e) =>
                  setPassword(
                    e.target.value
                  )
                }
                placeholder="Create a strong password"
                required
                className="h-11 w-full rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 pr-11 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500"
              />

              <button
                type="button"
                onClick={() =>
                  setShowPassword(
                    (prev) => !prev
                  )
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                aria-label={
                  showPassword
                    ? "Hide password"
                    : "Show password"
                }
              >
                {showPassword ? (
                  <EyeOff size={17} />
                ) : (
                  <Eye size={17} />
                )}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-800/30 p-3.5">
            <p className="mb-2 text-xs font-medium text-slate-400">
              Password requirements
            </p>

            <div className="space-y-1.5">
              {passwordRules.map(
                (rule) => (
                  <div
                    key={rule.label}
                    className={`flex items-center gap-2 text-xs ${
                      rule.valid
                        ? "text-emerald-400"
                        : "text-slate-500"
                    }`}
                  >
                    <span className="w-3.5 text-center">
                      {rule.valid
                        ? "✓"
                        : "○"}
                    </span>
                    {rule.label}
                  </div>
                )
              )}
            </div>
          </div>

          <button
            disabled={loading}
            className="h-11 w-full rounded-xl bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            {loading
              ? "Resetting..."
              : "Reset password"}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#020617]">
          <div className="text-sm text-slate-400">Loading...</div>
        </main>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
