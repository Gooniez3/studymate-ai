"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordRules = useMemo(
    () => [
      { label: "At least 8 characters", valid: password.length >= 8 },
      { label: "At least 1 uppercase letter", valid: /[A-Z]/.test(password) },
      { label: "At least 1 number", valid: /\d/.test(password) },
      { label: "At least 1 special character", valid: /[^A-Za-z0-9]/.test(password) },
    ],
    [password]
  );

  const isPasswordStrong = passwordRules.every((rule) => rule.valid);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Missing reset token.");
      return;
    }

    if (!isPasswordStrong) {
      setError("Please meet all password requirements.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }

    setSuccess(true);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-2xl">
            📚
          </div>

          <h1 className="text-2xl font-semibold text-white">Reset password</h1>

          <p className="mt-1 text-sm text-slate-400">
            Create a new strong password for your account.
          </p>
        </div>

        {success ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
            <p className="text-sm text-emerald-400">
              Your password has been reset successfully.
            </p>

            <Link
              href="/login"
              className="mt-5 inline-block text-sm font-medium text-blue-400 hover:text-blue-300"
            >
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
                {error}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm text-slate-400">
                New password
              </label>

              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password"
                  required
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 pr-11 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <p className="mb-2 text-xs font-medium text-slate-400">
                Password must contain:
              </p>

              <div className="space-y-1">
                {passwordRules.map((rule) => (
                  <div
                    key={rule.label}
                    className={`text-xs ${
                      rule.valid ? "text-emerald-400" : "text-slate-500"
                    }`}
                  >
                    {rule.valid ? "✓" : "○"} {rule.label}
                  </div>
                ))}
              </div>
            </div>

            <button
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "Resetting..." : "Reset password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}