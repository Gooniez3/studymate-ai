"use client";

import { useState } from "react";
import { CheckCircle, Mail, RefreshCw, X } from "lucide-react";

type VerifyEmailModalProps = {
  email: string;
  password: string;
  onClose: () => void;
  onVerified: () => Promise<void>;
};

export default function VerifyEmailModal({
  email,
  onClose,
  onVerified,
}: VerifyEmailModalProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  const handleVerify = async () => {
    setError("");
    setMessage("");

    if (code.length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }

    setVerifying(true);

    const res = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });

    const data = await res.json();
    setVerifying(false);

    if (!res.ok) {
      setError(data.error || "Invalid verification code.");
      return;
    }

    setMessage("Email verified successfully.");
    await onVerified();
  };

  const handleResend = async () => {
    setError("");
    setMessage("");
    setResending(true);

    const res = await fetch("/api/auth/resend-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();
    setResending(false);

    if (!res.ok) {
      setError(data.error || "Could not resend code.");
      return;
    }

    setMessage("New verification code sent.");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-[#111111] p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-500 hover:text-white"
        >
          <X size={18} />
        </button>

        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600/15 text-blue-400">
          <Mail size={28} />
        </div>

        <h2 className="text-center text-2xl font-semibold text-white">
          Check your email
        </h2>

        <p className="mt-2 text-center text-sm leading-relaxed text-slate-400">
          We sent a 6-digit verification code to{" "}
          <span className="font-medium text-slate-200">{email}</span>.
        </p>

        <div className="mt-6">
          <label className="mb-2 block text-sm text-slate-400">
            Verification code
          </label>

          <input
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            placeholder="000000"
            className="h-14 w-full rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 text-center text-2xl font-semibold tracking-[0.35em] text-white outline-none transition focus:border-blue-500"
          />
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
            {error}
          </div>
        )}

        {message && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-400">
            <CheckCircle size={16} />
            {message}
          </div>
        )}

        <button
          onClick={handleVerify}
          disabled={verifying}
          className="mt-5 h-11 w-full rounded-xl bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
        >
          {verifying ? "Verifying..." : "Verify email"}
        </button>

        <button
          onClick={handleResend}
          disabled={resending}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700/80 bg-slate-800/30 text-sm font-medium text-slate-300 transition hover:bg-slate-800/60 disabled:opacity-60"
        >
          <RefreshCw size={15} />
          {resending ? "Sending..." : "Resend code"}
        </button>
      </div>
    </div>
  );
}