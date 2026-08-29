"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, CheckCircle } from "lucide-react";
import AuthLayout from "@/components/auth/AuthLayout";

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
    <AuthLayout>
      <div className="mb-8 text-center lg:text-left">
        <h1 className="text-2xl font-semibold text-white">
          {step === "email" && "Reset your password"}
          {step === "code" && "Check your email"}
          {step === "password" && "Create a new password"}
          {step === "success" && "Password updated"}
        </h1>

        <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
          {step === "email" &&
            "Enter your email and we'll send you a 6-digit reset code."}
          {step === "code" &&
            "We sent a 6-digit verification code to your email."}
          {step === "password" &&
            "Choose a strong password for your account."}
          {step === "success" &&
            "Your password has been updated successfully."}
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
          {error}
        </div>
      )}

      {step === "email" && (
        <form onSubmit={handleSendCode} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-slate-300">
              Email
            </label>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="h-11 w-full rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500"
            />
          </div>

          <button
            disabled={loading}
            className="h-11 w-full rounded-xl bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send reset code"}
          </button>

          <p className="pt-2 text-center text-sm text-slate-500">
            Remember your password?{" "}
            <Link href="/login" className="text-blue-400 hover:text-blue-300">
              Sign in
            </Link>
          </p>
        </form>
      )}

      {step === "code" && (
        <div className="space-y-4">
          <input
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            placeholder="000000"
            className="h-14 w-full rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 text-center text-3xl font-semibold tracking-[0.35em] text-white outline-none transition focus:border-blue-500"
          />

          <button
            onClick={handleContinueCode}
            className="h-11 w-full rounded-xl bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            Continue
          </button>

          <button
            onClick={() => setStep("email")}
            className="h-11 w-full rounded-xl border border-slate-700/80 bg-slate-800/30 text-sm font-medium text-slate-300 transition hover:bg-slate-800/60"
          >
            Go back
          </button>
        </div>
      )}

      {step === "password" && (
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-slate-300">
              New password
            </label>

            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a strong password"
                required
                className="h-11 w-full rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 pr-11 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500"
              />

              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-800/30 p-3.5">
            <p className="mb-2 text-xs font-medium text-slate-400">
              Password requirements
            </p>

            <div className="space-y-1.5">
              {passwordRules.map((rule) => (
                <div
                  key={rule.label}
                  className={`flex items-center gap-2 text-xs ${
                    rule.valid ? "text-emerald-400" : "text-slate-500"
                  }`}
                >
                  <span className="w-3.5 text-center">
                    {rule.valid ? "✓" : "○"}
                  </span>
                  {rule.label}
                </div>
              ))}
            </div>
          </div>

          <button
            disabled={loading}
            className="h-11 w-full rounded-xl bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            {loading ? "Resetting..." : "Reset password"}
          </button>
        </form>
      )}

      {step === "success" && (
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
      )}
    </AuthLayout>
  );
}
