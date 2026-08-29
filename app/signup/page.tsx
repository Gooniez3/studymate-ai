"use client";

import { useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import AuthLayout from "@/components/auth/AuthLayout";
import VerifyEmailModal from "@/components/auth/VerifyEmailModal";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!isPasswordStrong) {
      setError("Please meet all password requirements.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }

    setShowVerifyModal(true);
  };

  const handleVerified = async () => {
    const signInRes = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (signInRes?.error) {
      window.location.href = "/login";
      return;
    }

    window.location.href = "/chat";
  };

  const handleGoogle = () => signIn("google", { callbackUrl: "/chat" });

  return (
    <AuthLayout>
      {showVerifyModal && (
        <VerifyEmailModal
          email={email}
          password={password}
          onClose={() => setShowVerifyModal(false)}
          onVerified={handleVerified}
        />
      )}

      <div className="mb-8 text-center lg:text-left">
        <h1 className="text-2xl font-semibold text-white">
          Create your account
        </h1>

        <p className="mt-1.5 text-sm text-slate-400">
          Start learning smarter with StudyMate AI.
        </p>
      </div>

      <button
        onClick={handleGoogle}
        className="mb-4 flex w-full items-center justify-center gap-3 rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Continue with Google
      </button>

      <div className="mb-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-800" />
        <span className="text-xs text-slate-500">or</span>
        <div className="h-px flex-1 bg-slate-800" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5">
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
            {error}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm text-slate-300">
            Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            required
            className="h-11 w-full rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500"
          />
        </div>

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

        <div>
          <label className="mb-1.5 block text-sm text-slate-300">
            Password
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
          className="mt-1 h-11 w-full rounded-xl bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
        >
          {loading ? "Creating account..." : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="text-blue-400 hover:text-blue-300">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
