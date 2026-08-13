"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";

type Step = "email" | "code" | "password" | "success";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const passwordRules = useMemo(
    () => [
      { label: "At least 8 characters", valid: password.length >= 8 },
      { label: "At least 1 uppercase letter", valid: /[A-Z]/.test(password) },
      { label: "At least 1 number", valid: /\d/.test(password) },
      {
        label: "At least 1 special character",
        valid: /[^A-Za-z0-9]/.test(password),
      },
    ],
    [password]
  );

  const isPasswordStrong = passwordRules.every((rule) => rule.valid);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong.");
      return;
    }

    setStep("code");
  };

  const handleContinueCode = () => {
    setError("");

    if (code.length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }

    setStep("password");
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!isPasswordStrong) {
      setError("Please meet all password requirements.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, password }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }

    setStep("success");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-2xl">
            📚
          </div>

          <h1 className="text-3xl font-semibold text-white">
            {step === "email" && "Forgot password?"}
            {step === "code" && "Verify your email"}
            {step === "password" && "Create new password"}
            {step === "success" && "Password reset"}
          </h1>

          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            {step === "email" &&
              "Enter your email and we’ll send you a reset code."}
            {step === "code" &&
              "We’ve sent a 6-digit code to your email. Enter it below to continue."}
            {step === "password" &&
              "Choose a strong new password for your account."}
            {step === "success" &&
              "Your password has been updated successfully."}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
            {error}
          </div>
        )}

        {step === "email" && (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-slate-400">
                Email
              </label>

              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500"
              />
            </div>

            <button
              disabled={loading}
              className="w-full rounded-xl bg-blue-600 py-3 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "Sending..." : "Send reset code"}
            </button>

            <p className="pt-3 text-center text-sm text-slate-500">
              Remember password?{" "}
              <Link href="/login" className="text-blue-400 hover:text-blue-300">
                Sign in
              </Link>
            </p>
          </form>
        )}

        {step === "code" && (
          <div className="space-y-5">
            <input
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
              placeholder="000000"
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-4 text-center text-3xl font-semibold tracking-[0.4em] text-white outline-none transition focus:border-blue-500"
            />

            <button
              onClick={handleContinueCode}
              className="w-full rounded-full bg-white py-3 text-sm font-medium text-black transition hover:bg-slate-200"
            >
              Continue
            </button>

            <button
              onClick={() => setStep("email")}
              className="w-full rounded-full border border-slate-700 py-3 text-sm font-medium text-white transition hover:bg-slate-900"
            >
              Go Back
            </button>
          </div>
        )}

        {step === "password" && (
          <form onSubmit={handleResetPassword} className="space-y-4">
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
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 pr-11 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500"
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
              className="w-full rounded-xl bg-blue-600 py-3 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "Resetting..." : "Reset password"}
            </button>
          </form>
        )}

        {step === "success" && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
            <p className="text-sm text-emerald-400">
              You can now sign in with your new password.
            </p>

            <Link
              href="/login"
              className="mt-5 inline-block text-sm font-medium text-blue-400 hover:text-blue-300"
            >
              Back to login
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}