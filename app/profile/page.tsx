"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type UserProfile = {
  id: string;
  name: string;
  email: string;
  image?: string;
  emailVerified: boolean;
  accountType: "Google" | "Email & Password";
  loginMethod: string;
  passwordUpdatedAt: string | null;
  defaultMode: string;
  webSearchDefault: boolean;
  theme: string;
  createdAt: string;
};

type ProfileResponse = {
  user: UserProfile;
  stats: {
    totalChats: number;
  };
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);

  const [name, setName] = useState("");
  const [defaultMode, setDefaultMode] = useState("default");
  const [webSearchDefault, setWebSearchDefault] = useState(false);
  const [theme, setTheme] = useState("system");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const res = await fetch("/api/user/profile");
    const data = await res.json();

    if (res.ok) {
      setProfile(data);
      setName(data.user.name || "");
      setDefaultMode(data.user.defaultMode || "default");
      setWebSearchDefault(data.user.webSearchDefault ?? false);
      setTheme(data.user.theme || "system");
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    setMessage("");
    setError("");
    setLoading(true);

    const payload: Record<string, unknown> = {
      name,
      defaultMode,
      webSearchDefault,
      theme,
    };

    if (currentPassword || newPassword) {
      payload.currentPassword = currentPassword;
      payload.newPassword = newPassword;
    }

    const res = await fetch("/api/user/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }

    setMessage("Account settings updated successfully.");
    setCurrentPassword("");
    setNewPassword("");
    await loadProfile();
  }

  async function handleExportChats() {
    setError("");
    setMessage("");
    setDataLoading(true);

    const res = await fetch("/api/user/data");
    const data = await res.json();

    setDataLoading(false);

    if (!res.ok) {
      setError(data.error || "Failed to export chat history.");
      return;
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = `studymate-ai-chat-history-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);

    setMessage("Chat history exported successfully.");
  }

  async function handleDeleteAllChats() {
    const confirmed = window.confirm(
      "Are you sure you want to delete all chat history? This action cannot be undone."
    );

    if (!confirmed) return;

    setError("");
    setMessage("");
    setDataLoading(true);

    const res = await fetch("/api/user/data", {
      method: "DELETE",
    });

    const data = await res.json();

    setDataLoading(false);

    if (!res.ok) {
      setError(data.error || "Failed to delete chats.");
      return;
    }

    setMessage("All chats deleted successfully.");
    await loadProfile();
  }

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      "This will permanently delete your account and all your chats. Are you sure?"
    );

    if (!confirmed) return;

    const secondConfirm = window.confirm(
      "Final confirmation: delete your StudyMate AI account permanently?"
    );

    if (!secondConfirm) return;

    setError("");
    setMessage("");
    setDataLoading(true);

    const res = await fetch("/api/user/account", {
      method: "DELETE",
    });

    const data = await res.json();

    setDataLoading(false);

    if (!res.ok) {
      setError(data.error || "Failed to delete account.");
      return;
    }

    window.location.href = "/signup";
  }

  function formatDate(date: string | null) {
    if (!date) return "Not available";

    return new Date(date).toLocaleDateString("en-SG", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  if (!profile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0a0a] text-white">
        Loading account settings...
      </main>
    );
  }

  const user = profile.user;
  const hasPassword = user.accountType === "Email & Password";

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-5xl">
        <Link href="/chat" className="text-sm text-blue-400 hover:text-blue-300">
          ← Back to chat
        </Link>

        <div className="mt-8">
          <h1 className="text-3xl font-semibold">Account Settings</h1>
          <p className="mt-2 text-sm text-slate-400">
            Manage your StudyMate AI profile, login security, preferences, and data.
          </p>
        </div>

        {(message || error) && (
          <div className="mt-6 space-y-3">
            {message && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                {message}
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSave} className="mt-6 space-y-6">
          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
            <h2 className="text-lg font-semibold">General</h2>
            <p className="mt-1 text-sm text-slate-500">
              Basic account information used across StudyMate AI.
            </p>

            <div className="mt-6 flex items-center gap-4">
              {user.image ? (
                <img
                  src={user.image}
                  alt={user.name || "User avatar"}
                  className="h-20 w-20 rounded-full border border-slate-700 object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-600 text-2xl font-bold">
                  {user.name?.[0]?.toUpperCase() || "U"}
                </div>
              )}

              <div>
                <p className="font-medium">{user.email}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-slate-300">
                    {user.accountType}
                  </span>

                  <span
                    className={`rounded-full border px-3 py-1 ${
                      user.emailVerified
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                    }`}
                  >
                    {user.emailVerified ? "Verified" : "Not verified"}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm text-slate-400">
                  Display name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm text-slate-400">
                  Email
                </label>
                <input
                  value={user.email}
                  disabled
                  className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-500"
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
            <h2 className="text-lg font-semibold">Security</h2>
            <p className="mt-1 text-sm text-slate-500">
              Manage your login method and password security.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <InfoCard title="Login method" value={user.loginMethod} />
              <InfoCard
                title="Password last updated"
                value={formatDate(user.passwordUpdatedAt)}
              />
            </div>

            {hasPassword ? (
              <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                <h3 className="font-medium">Change password</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Password must have 8+ characters, 1 uppercase letter, 1 number,
                  and 1 special character.
                </p>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-blue-500"
                  />

                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-400">
                This account uses Google login. Password change is not available.
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
            <h2 className="text-lg font-semibold">Preferences</h2>
            <p className="mt-1 text-sm text-slate-500">
              Set your default StudyMate AI experience.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-sm text-slate-400">
                  Default chat mode
                </label>
                <select
                  value={defaultMode}
                  onChange={(e) => setDefaultMode(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm outline-none focus:border-blue-500"
                >
                  <option value="general">General</option>
                  <option value="exam">Exam Revision</option>
                  <option value="assignment">Assignment Help</option>
                  <option value="cv">CV / LinkedIn Help</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm text-slate-400">
                  Web search default
                </label>
                <button
                  type="button"
                  onClick={() => setWebSearchDefault((prev) => !prev)}
                  className={`w-full rounded-xl border px-4 py-3 text-left text-sm ${
                    webSearchDefault
                      ? "border-blue-500 bg-blue-500/10 text-blue-300"
                      : "border-slate-700 bg-slate-900 text-slate-300"
                  }`}
                >
                  {webSearchDefault ? "ON" : "OFF"}
                </button>
              </div>

              <div>
                <label className="mb-1.5 block text-sm text-slate-400">
                  Theme
                </label>
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm outline-none focus:border-blue-500"
                >
                  <option value="system">System</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>
            </div>
          </section>

          <button
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? "Saving changes..." : "Save account settings"}
          </button>
        </form>

        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
          <h2 className="text-lg font-semibold">Data</h2>
          <p className="mt-1 text-sm text-slate-500">
            Export or manage your StudyMate AI chat history.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <InfoCard title="Total chats" value={String(profile.stats.totalChats)} />

            <button
              onClick={handleExportChats}
              disabled={dataLoading}
              className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-4 text-left text-sm hover:border-blue-500 disabled:opacity-60"
            >
              <p className="font-medium text-white">Export chat history</p>
              <p className="mt-1 text-xs text-slate-500">
                Download your chats as JSON.
              </p>
            </button>

            <button
              onClick={handleDeleteAllChats}
              disabled={dataLoading}
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-4 text-left text-sm text-red-300 hover:bg-red-500/20 disabled:opacity-60"
            >
              <p className="font-medium">Delete all chats</p>
              <p className="mt-1 text-xs text-red-300/70">
                Remove all saved conversations.
              </p>
            </button>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
             <div>
                <h2 className="text-lg font-semibold text-white">Account removal</h2>
                <p className="mt-1 max-w-xl text-sm text-slate-500">
                    Permanently delete your StudyMate AI account, profile information, and
                    saved chat history. This action cannot be undone.
                </p>
            </div>

          <button
            onClick={handleDeleteAccount}
            disabled={dataLoading}
            className="rounded-xl border border-red-500/40 px-5 py-3 text-sm font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-60"
          >
            Delete account
          </button>
        </div>
        </section>
     </div>
    </main>
  );
}

function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-4">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="mt-1 text-sm font-medium text-slate-200">{value}</p>
    </div>
  );
}