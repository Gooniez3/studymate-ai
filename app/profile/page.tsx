"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  User,
  Shield,
  SlidersHorizontal,
  Database,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle,
  Download,
  Trash2,
} from "lucide-react";

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

const NAV_ITEMS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "security", label: "Security", icon: Shield },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "data", label: "Data & Privacy", icon: Database },
] as const;

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);

  const [name, setName] = useState("");
  const [defaultMode, setDefaultMode] = useState("default");
  const [webSearchDefault, setWebSearchDefault] = useState(false);
  const [theme, setTheme] = useState("system");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    try {
      const res = await fetch("/api/user/profile");
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to load account settings.");
        return;
      }

      setProfile(data);
      setName(data.user.name || "");
      setDefaultMode(data.user.defaultMode || "default");
      setWebSearchDefault(data.user.webSearchDefault ?? false);
      setTheme(data.user.theme || "system");

      const resolved = data.user.theme || "system";
      document.documentElement.classList.remove("dark", "light", "system");
      document.documentElement.classList.add(resolved);
      try {
        localStorage.setItem("studymate-theme", resolved);
      } catch {}
    } catch (error) {
      console.error("LOAD_PROFILE_ERROR:", error);
      setError("Failed to load account settings.");
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    setLoading(true);

    try {
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

      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      setMessage("Account settings updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      await loadProfile();
    } catch (error) {
      console.error("SAVE_PROFILE_ERROR:", error);
      setError("Unable to update your account settings.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExportChats() {
    setError("");
    setMessage("");
    setDataLoading(true);

    try {
      const res = await fetch("/api/user/data");
      const data = await res.json();

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
    } catch (error) {
      console.error("EXPORT_CHATS_ERROR:", error);
      setError("Failed to export chat history.");
    } finally {
      setDataLoading(false);
    }
  }

  async function handleDeleteAllChats() {
    const confirmed = window.confirm(
      "Are you sure you want to permanently delete all chat history? This action cannot be undone."
    );
    if (!confirmed) return;

    setError("");
    setMessage("");
    setDataLoading(true);

    try {
      const res = await fetch("/api/user/data", { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to delete chats.");
        return;
      }

      setMessage("All chats deleted successfully.");
      await loadProfile();
    } catch (error) {
      console.error("DELETE_ALL_CHATS_ERROR:", error);
      setError("Unable to delete your chats.");
    } finally {
      setDataLoading(false);
    }
  }

  function openDeleteAccountModal() {
    setDeleteConfirmation("");
    setError("");
    setMessage("");
    setDeleteAccountOpen(true);
  }

  function closeDeleteAccountModal() {
    if (deletingAccount) return;
    setDeleteAccountOpen(false);
    setDeleteConfirmation("");
  }

  async function handleDeleteAccount() {
    if (deleteConfirmation !== "CONFIRM") return;

    setError("");
    setMessage("");
    setDeletingAccount(true);

    try {
      const res = await fetch("/api/user/account", { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to delete account.");
        setDeletingAccount(false);
        return;
      }

      window.location.href = "/signup";
    } catch (error) {
      console.error("DELETE_ACCOUNT_ERROR:", error);
      setError("Unable to delete your account. Please try again.");
      setDeletingAccount(false);
    }
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
      <main className="flex min-h-screen items-center justify-center bg-[#020617]">
        <div className="text-sm text-slate-400">Loading account settings...</div>
      </main>
    );
  }

  const user = profile.user;
  const hasPassword = user.accountType === "Email & Password";

  return (
    <main className="min-h-screen bg-[#020617] text-white">
      {/* ── Top navigation ── */}
      <header className="border-b border-slate-800/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5">
          <Link
            href="/chat"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-slate-200"
          >
            <ArrowLeft size={15} />
            Back to chat
          </Link>

          <span className="text-sm font-semibold text-slate-200">
            StudyMate AI
          </span>
        </div>
      </header>

      {/* ── Page header ── */}
      <div className="mx-auto max-w-7xl px-5 pt-8 pb-2">
        <h1 className="text-2xl font-semibold text-white">
          Account Settings
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Manage your profile, security, preferences and data.
        </p>
      </div>

      {/* ── Flash messages ── */}
      {(message || error) && (
        <div className="mx-auto max-w-7xl px-5 py-3">
          {message && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-400">
              <CheckCircle size={15} />
              {message}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
              <AlertTriangle size={15} />
              {error}
            </div>
          )}
        </div>
      )}

      {/* ── Settings layout ── */}
      <div className="mx-auto grid max-w-7xl grid-cols-1 px-5 pb-16 pt-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Left navigation (desktop) */}
        <nav className="hidden lg:block">
          <div className="sticky top-8 space-y-1">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-slate-800/50 hover:text-slate-200"
              >
                <item.icon size={16} className="shrink-0" />
                {item.label}
              </a>
            ))}
          </div>
        </nav>

        {/* Right content */}
        <form onSubmit={handleSave}>
          <div className="space-y-10">
            {/* ═══ Profile ═══ */}
            <section id="profile">
              <SectionHeader
                title="Profile"
                subtitle="Manage your personal information."
              />

              <div className="mt-5 flex items-center gap-4">
                {user.image ? (
                  <img
                    src={user.image}
                    alt={user.name || "User avatar"}
                    className="h-16 w-16 rounded-full border border-slate-700 object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xl font-bold text-white">
                    {user.name?.[0]?.toUpperCase() || "U"}
                  </div>
                )}

                <div className="min-w-0">
                  <p className="truncate font-medium text-white">
                    {user.name || "Unnamed user"}
                  </p>
                  <p className="truncate text-sm text-slate-400">
                    {user.email}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-md border border-slate-700/60 bg-slate-800/50 px-2 py-0.5 text-xs text-slate-300">
                      {user.accountType}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs ${
                        user.emailVerified
                          ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                          : "border border-yellow-500/20 bg-yellow-500/10 text-yellow-400"
                      }`}
                    >
                      {user.emailVerified ? "Verified" : "Not verified"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <Field label="Display name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500"
                  />
                </Field>

                <Field label="Email address">
                  <input
                    value={user.email}
                    disabled
                    className="h-11 w-full rounded-xl border border-slate-800/60 bg-slate-800/30 px-4 text-sm text-slate-400"
                  />
                </Field>
              </div>
            </section>

            <Divider />

            {/* ═══ Security ═══ */}
            <section id="security">
              <SectionHeader
                title="Security"
                subtitle="Manage your sign-in method and password."
              />

              <div className="mt-5 space-y-0 rounded-xl border border-slate-800/60">
                <InfoRow
                  label="Login method"
                  value={user.loginMethod}
                />
                <InfoRow
                  label="Password last updated"
                  value={formatDate(user.passwordUpdatedAt)}
                  last
                />
              </div>

              {hasPassword ? (
                <div className="mt-6">
                  <h3 className="text-sm font-medium text-white">
                    Change password
                  </h3>

                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="mb-1.5 block text-xs text-slate-500">
                        Current password
                      </label>
                      <div className="relative">
                        <input
                          type={showCurrentPassword ? "text" : "password"}
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="••••••••"
                          className="h-11 w-full rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 pr-11 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCurrentPassword((p) => !p)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                          aria-label={
                            showCurrentPassword ? "Hide password" : "Show password"
                          }
                        >
                          {showCurrentPassword ? (
                            <EyeOff size={16} />
                          ) : (
                            <Eye size={16} />
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs text-slate-500">
                        New password
                      </label>
                      <div className="relative">
                        <input
                          type={showNewPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="••••••••"
                          className="h-11 w-full rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 pr-11 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword((p) => !p)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                          aria-label={
                            showNewPassword ? "Hide password" : "Show password"
                          }
                        >
                          {showNewPassword ? (
                            <EyeOff size={16} />
                          ) : (
                            <Eye size={16} />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>8+ characters</span>
                      <span>1 uppercase</span>
                      <span>1 number</span>
                      <span>1 special character</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-xl border border-slate-800/60 bg-slate-800/20 px-4 py-3 text-sm text-slate-400">
                  Your account uses Google sign-in. Password management is
                  handled through Google.
                </div>
              )}
            </section>

            <Divider />

            {/* ═══ Preferences ═══ */}
            <section id="preferences">
              <SectionHeader
                title="Preferences"
                subtitle="Customize how StudyMate AI behaves by default."
              />

              <div className="mt-5 space-y-5">
                <Field label="Default chat mode">
                  <select
                    value={defaultMode}
                    onChange={(e) => setDefaultMode(e.target.value)}
                    className="h-11 w-full appearance-none rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 text-sm text-white outline-none transition focus:border-blue-500"
                  >
                    <option value="default">General</option>
                    <option value="exam">Exam Revision</option>
                    <option value="assignment">Assignment Help</option>
                    <option value="career">CV / LinkedIn Help</option>
                  </select>
                </Field>

                <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-800/60 px-4 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">Web search</p>
                    <p className="text-xs text-slate-500">
                      Automatically enable web search for new chats.
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={webSearchDefault}
                    onClick={() => setWebSearchDefault((prev) => !prev)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
                      webSearchDefault ? "bg-blue-600" : "bg-slate-700"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform ${
                        webSearchDefault ? "translate-x-5.5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>

                <Field label="Theme">
                  <select
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    className="h-11 w-full appearance-none rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 text-sm text-white outline-none transition focus:border-blue-500"
                  >
                    <option value="system">System</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </Field>
              </div>
            </section>

            {/* ── Save ── */}
            <div className="flex items-center justify-end gap-3 pt-2">
              {message && (
                <span className="text-xs text-slate-500">
                  Changes are saved when you click Save changes.
                </span>
              )}
              <button
                disabled={loading}
                className="h-10 rounded-xl bg-blue-600 px-5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
              >
                {loading ? "Saving changes..." : "Save changes"}
              </button>
            </div>

            <Divider />

            {/* ═══ Data & Privacy ═══ */}
            <section id="data">
              <SectionHeader
                title="Data & Privacy"
                subtitle="Export or manage your StudyMate AI data."
              />

              <div className="mt-5 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">
                      Chat history
                    </p>
                    <p className="text-xs text-slate-500">
                      {profile.stats.totalChats} saved{" "}
                      {profile.stats.totalChats === 1 ? "conversation" : "conversations"}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleExportChats}
                      disabled={dataLoading}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-800/30 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-slate-800/60 disabled:opacity-60"
                    >
                      <Download size={14} />
                      Export data
                    </button>

                    <button
                      type="button"
                      onClick={handleDeleteAllChats}
                      disabled={dataLoading}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 px-4 py-2.5 text-sm text-red-400 transition hover:bg-red-500/10 disabled:opacity-60"
                    >
                      <Trash2 size={14} />
                      Delete all chats
                    </button>
                  </div>
                </div>

                <div className="border-t border-slate-800/60 pt-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">
                        Delete account
                      </p>
                      <p className="text-xs text-slate-500">
                        Permanently delete your StudyMate AI account and
                        associated data.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={openDeleteAccountModal}
                      disabled={dataLoading}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-medium text-red-400 transition hover:bg-red-500/10 disabled:opacity-60"
                    >
                      Delete account
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </form>
      </div>

      {/* ═══ Delete account modal ═══ */}
      {deleteAccountOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0f172a] p-6 shadow-2xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500/10">
              <AlertTriangle size={20} className="text-red-400" />
            </div>

            <h2
              id="delete-modal-title"
              className="mt-5 text-lg font-semibold text-white"
            >
              Delete account?
            </h2>

            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              This permanently deletes your account and associated StudyMate AI
              data. This action cannot be undone.
            </p>

            <div className="mt-5">
              <label className="mb-2 block text-sm text-slate-300">
                Type{" "}
                <span className="font-semibold text-white">CONFIRM</span> to
                continue
              </label>

              <input
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                placeholder="CONFIRM"
                autoComplete="off"
                disabled={deletingAccount}
                className="h-11 w-full rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-red-500 disabled:opacity-60"
              />
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                disabled={deletingAccount}
                onClick={closeDeleteAccountModal}
                className="h-10 flex-1 rounded-xl border border-slate-700/80 bg-slate-800/30 text-sm font-medium text-slate-300 transition hover:bg-slate-800/60 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={deleteConfirmation !== "CONFIRM" || deletingAccount}
                onClick={handleDeleteAccount}
                className="h-10 flex-1 rounded-xl bg-red-600 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deletingAccount ? "Deleting..." : "Delete account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ── Small presentational helpers ── */

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm text-slate-300">{label}</label>
      {children}
    </div>
  );
}

function InfoRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-3 ${
        last ? "" : "border-b border-slate-800/60"
      }`}
    >
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm text-slate-200">{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-slate-800/60" />;
}
