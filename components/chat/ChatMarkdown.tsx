import { Check, Copy, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMarkdownProps = {
  content: string;
  copiedCode: string | null;
  onCopyCode: (code: string) => void;
};

function parseSourcesFromContent(content: string): {
  body: string;
  sources: { title: string; url: string }[];
} {
  const sourcesMatch = content.match(/\n*---\n*\*\*Sources\*\*\n+([\s\S]+)$/i);

  if (!sourcesMatch) return { body: content, sources: [] };

  const body = content.slice(0, content.indexOf(sourcesMatch[0])).trim();
  const sourcesRaw = sourcesMatch[1].trim();
  const sources: { title: string; url: string }[] = [];

  const linkRegex = /- \[(.+?)\]\((https?:\/\/.+?)\)/g;

  let match;

  while ((match = linkRegex.exec(sourcesRaw)) !== null) {
    sources.push({
      title: match[1],
      url: match[2],
    });
  }

  return { body, sources };
}

function SourceCards({
  sources,
}: {
  sources: { title: string; url: string }[];
}) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700/60">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
        Sources ({sources.length})
      </p>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {sources.map((s, i) => {
          let hostname = "";

          try {
            hostname = new URL(s.url).hostname.replace("www.", "");
          } catch {}

          return (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 no-underline transition hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700/70 dark:bg-slate-800/40 dark:hover:border-slate-500 dark:hover:bg-slate-800"
            >
              <img
                src={`https://www.google.com/s2/favicons?sz=32&domain=${hostname}`}
                alt=""
                className="h-4 w-4 shrink-0 rounded"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium leading-tight text-slate-700 group-hover:text-slate-950 dark:text-slate-300 dark:group-hover:text-white">
                  {s.title}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {hostname}
                </p>
              </div>

              <ExternalLink
                size={12}
                className="shrink-0 text-slate-400 transition group-hover:text-slate-600 dark:text-slate-600 dark:group-hover:text-slate-400"
              />
            </a>
          );
        })}
      </div>
    </div>
  );
}

export default function ChatMarkdown({
  content,
  copiedCode,
  onCopyCode,
}: ChatMarkdownProps) {
  const { body, sources } =
  parseSourcesFromContent(content);

const displayBody =
  body.replace(
    /\[EVIDENCE_(\d+)\]/g,
    "[$1]"
  );

  return (
    <div className="w-full">
      <div className="max-w-none overflow-x-auto prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-headings:my-3 prose-headings:font-semibold prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline dark:prose-a:text-blue-400">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="mb-2 mt-5 text-lg font-bold text-slate-950 dark:text-white">
                {children}
              </h1>
            ),

            h2: ({ children }) => (
              <h2 className="mb-2 mt-5 text-base font-semibold text-slate-950 dark:text-white">
                {children}
              </h2>
            ),

            h3: ({ children }) => (
              <h3 className="mb-1 mt-4 text-sm font-semibold text-slate-800 dark:text-slate-200">
                {children}
              </h3>
            ),

            p: ({ children }) => (
              <p className="my-2 leading-relaxed text-slate-800 dark:text-slate-200">
                {children}
              </p>
            ),

            ul: ({ children }) => (
              <ul className="my-3 space-y-1.5 pl-1">{children}</ul>
            ),

            ol: ({ children }) => (
              <ol className="my-3 list-decimal space-y-1.5 pl-4">
                {children}
              </ol>
            ),

            li: ({ children }) => (
              <li className="flex gap-2.5 leading-relaxed text-slate-800 dark:text-slate-200">
                <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500 dark:bg-blue-400" />
                <span>{children}</span>
              </li>
            ),

            hr: () => (
              <hr className="my-5 border-slate-200 dark:border-slate-700/60" />
            ),

            a: ({ href, children, ...props }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline dark:text-blue-400"
                {...props}
              >
                {children}
              </a>
            ),

            code({ className, children, ...props }) {
              const codeText = String(children).replace(/\n$/, "");
              const isBlockCode =
                className?.includes("language-") || codeText.includes("\n");

              if (isBlockCode) {
                return (
                  <div className="my-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
                    <div className="flex items-center justify-between bg-slate-100 px-4 py-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-400">
                      <span>{className?.replace("language-", "") || "code"}</span>

                      <button
                        onClick={() => onCopyCode(codeText)}
                        className="flex items-center gap-1 transition hover:text-slate-950 dark:hover:text-white"
                      >
                        {copiedCode === codeText ? (
                          <>
                            <Check size={14} />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy size={14} />
                            Copy
                          </>
                        )}
                      </button>
                    </div>

                    <pre className="max-h-[350px] overflow-x-auto p-4 text-xs text-slate-800 dark:text-slate-100">
                      <code
                        className={`${className || ""} font-mono text-xs`}
                        {...props}
                      >
                        {children}
                      </code>
                    </pre>
                  </div>
                );
              }

              return (
                <code
                  className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm text-slate-800 dark:bg-slate-700 dark:text-slate-100"
                  {...props}
                >
                  {children}
                </code>
              );
            },

            table: ({ children }) => (
              <div className="my-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">{children}</table>
              </div>
            ),

            thead: ({ children }) => (
              <thead className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {children}
              </thead>
            ),

            tbody: ({ children }) => (
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {children}
              </tbody>
            ),

            tr: ({ children }) => (
              <tr className="transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
                {children}
              </tr>
            ),

            th: ({ children }) => (
              <th className="px-4 py-2 text-left font-semibold text-slate-700 dark:text-slate-300">
                {children}
              </th>
            ),

            td: ({ children }) => (
              <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                {children}
              </td>
            ),

            blockquote: ({ children }) => (
              <blockquote className="my-3 border-l-4 border-blue-500 pl-4 italic text-slate-500 dark:text-slate-400">
                {children}
              </blockquote>
            ),
          }}
        >
          {displayBody}
        </ReactMarkdown>
      </div>

      <SourceCards sources={sources} />
    </div>
  );
}