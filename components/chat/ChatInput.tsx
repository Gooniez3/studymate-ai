import {
  FileText,
  Globe,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import { useRef } from "react";

type ChatInputProps = {
  input: string;
  isLoading: boolean;
  webSearchEnabled: boolean;
  selectedFile: File | null;
  setInput: (value: string) => void;
  setWebSearchEnabled: (value: boolean) => void;
  setSelectedFile: (file: File | null) => void;
  onSend: () => void;
};

export default function ChatInput({
  input,
  isLoading,
  webSearchEnabled,
  selectedFile,
  setInput,
  setWebSearchEnabled,
  setSelectedFile,
  onSend,
}: ChatInputProps) {
  const fileInputRef =
    useRef<HTMLInputElement | null>(
      null
    );

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];

    if (!file) return;

    if (
      file.type !== "application/pdf"
    ) {
      alert(
        "Only PDF files are supported for now."
      );

      e.target.value = "";

      return;
    }

    if (
      file.size > 10 * 1024 * 1024
    ) {
      alert("PDF must be under 10MB.");

      e.target.value = "";

      return;
    }

    setSelectedFile(file);

    e.target.value = "";
  };

  return (
    <div className="shrink-0 px-3 pb-3 pt-1 md:px-4">
      <div className="mx-auto max-w-4xl">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm transition-colors focus-within:border-blue-500/50 focus-within:ring-2 focus-within:ring-blue-500/10 dark:border-white/10 dark:bg-slate-900">
          {selectedFile && (
            <div className="mx-2 mt-2 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-slate-800/70">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600/15 text-blue-600 dark:text-blue-300">
                  <FileText size={15} />
                </div>

                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-100">
                    {selectedFile.name}
                  </p>

                  <p className="text-[11px] text-slate-400">
                    {(
                      selectedFile.size /
                      1024 /
                      1024
                    ).toFixed(2)}{" "}
                    MB · PDF
                  </p>
                </div>
              </div>

              <button
                type="button"

                onClick={() =>
                  setSelectedFile(null)
                }

                title="Remove attachment"

                className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              >
                <X size={14} />
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}

            type="file"

            accept="application/pdf"

            onChange={handleFileChange}

            className="hidden"
          />

          <input
            value={input}

            disabled={isLoading}

            onChange={(e) =>
              setInput(e.target.value)
            }

            onKeyDown={(e) => {
              if (e.key === "Enter")
                onSend();
            }}

            placeholder={
              isLoading
                ? "StudyMate is thinking..."
                : selectedFile
                ? "Ask about this PDF..."
                : "Ask StudyMate AI anything..."
            }

            className="w-full bg-transparent px-4 pb-1 pt-3.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-60 dark:text-slate-100"
          />

          <div className="flex items-center gap-1 px-2 pb-2 pt-1">
            <button
              type="button"

              disabled={isLoading}

              onClick={() =>
                fileInputRef.current?.click()
              }

              title="Add PDF"

              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-800 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <Paperclip size={16} />
            </button>

            <button
              type="button"

              onClick={() =>
                setWebSearchEnabled(
                  !webSearchEnabled
                )
              }

              title={
                webSearchEnabled
                  ? "Web search on"
                  : "Web search off"
              }

              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition ${
                webSearchEnabled
                  ? "bg-blue-600/15 text-blue-700 ring-1 ring-inset ring-blue-500/30 dark:text-blue-300"
                  : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              }`}
            >
              <Globe size={14} />

              Web

              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  webSearchEnabled
                    ? "bg-blue-500"
                    : "bg-slate-300 dark:bg-slate-600"
                }`}
              />
            </button>

            <div className="flex-1" />

            <button
              onClick={onSend}

              disabled={
                isLoading ||
                (!input.trim() &&
                  !selectedFile)
              }

              title="Send message"

              className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-500 disabled:bg-blue-600/40 dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              <Send size={16} />
            </button>
          </div>
        </div>

        <p className="mt-2 text-center text-[11px] text-slate-400">
          StudyMate AI can make mistakes.
          Check important information.
        </p>
      </div>
    </div>
  );
}
