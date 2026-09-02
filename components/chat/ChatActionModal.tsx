"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";

type ChatActionModalProps = {
  type: "rename" | "delete";
  chatId: string;
  currentTitle: string;
  onClose: () => void;
  onConfirm: (chatId: string, newTitle?: string) => Promise<void>;
};

export default function ChatActionModal({
  type,
  chatId,
  currentTitle,
  onClose,
  onConfirm,
}: ChatActionModalProps) {
  const [value, setValue] = useState(currentTitle);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const isRename = type === "rename";
  const trimmed = value.trim();
  const canSubmit = isRename ? trimmed.length > 0 && !submitting : !submitting;

  useEffect(() => {
    if (isRename && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRename]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      if (isRename) {
        await onConfirm(chatId, trimmed);
      } else {
        await onConfirm(chatId);
      }
      onClose();
    } catch {
      setSubmitting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) {
      onClose();
    }
  };

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-action-title"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-[#111111] p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-500 hover:text-white"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div
          className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl ${
            isRename
              ? "bg-blue-600/15 text-blue-400"
              : "bg-red-600/15 text-red-400"
          }`}
        >
          {isRename ? <Pencil size={26} /> : <Trash2 size={26} />}
        </div>

        <h2
          id="chat-action-title"
          className="text-center text-xl font-semibold text-white"
        >
          {isRename ? "Rename chat" : "Delete chat?"}
        </h2>

        <p className="mt-2 text-center text-sm leading-relaxed text-slate-400">
          {isRename
            ? "Choose a short name for this conversation."
            : "This chat will be permanently removed. This action cannot be undone."}
        </p>

        {isRename && (
          <div className="mt-5">
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Chat title"
              className="h-11 w-full rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500"
            />
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-xl border border-slate-700/80 bg-slate-800/30 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800/60 disabled:opacity-60"
          >
            Cancel
          </button>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60 ${
              isRename
                ? "bg-blue-600 hover:bg-blue-500"
                : "bg-red-600 hover:bg-red-500"
            }`}
          >
            {submitting
              ? isRename
                ? "Saving..."
                : "Deleting..."
              : isRename
                ? "Save"
                : "Delete chat"}
          </button>
        </div>
      </div>
    </div>
  );
}
