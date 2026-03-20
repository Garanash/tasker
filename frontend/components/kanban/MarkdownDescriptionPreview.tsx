"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MdProps = {
  source: string;
  emptyLabel: string;
};

function Anchor({
  href,
  children,
  ...rest
}: ComponentPropsWithoutRef<"a">): ReactNode {
  const safe = href && !href.startsWith("javascript:") && !href.startsWith("data:") ? href : undefined;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#A020F0] underline underline-offset-2 hover:opacity-90"
      {...rest}
    >
      {children}
    </a>
  );
}

export function MarkdownDescriptionPreview({ source, emptyLabel }: MdProps) {
  const trimmed = source.trim();
  if (!trimmed) {
    return <p className="text-sm italic text-[var(--k-text-muted)]">{emptyLabel}</p>;
  }

  return (
    <div className="markdown-description-preview text-[var(--k-text)] text-sm leading-relaxed">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children, ...props }) => (
            <h1 className="mt-3 mb-2 text-xl font-bold tracking-tight" {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="mt-3 mb-2 text-lg font-bold tracking-tight" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="mt-2 mb-1 text-base font-semibold" {...props}>
              {children}
            </h3>
          ),
          p: ({ children, ...props }) => (
            <p className="mb-2 last:mb-0" {...props}>
              {children}
            </p>
          ),
          ul: ({ children, ...props }) => (
            <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0" {...props}>
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="leading-relaxed" {...props}>
              {children}
            </li>
          ),
          blockquote: ({ children, ...props }) => (
            <blockquote
              className="my-2 border-l-4 border-[#8A2BE2] pl-3 italic text-[var(--k-text-muted)]"
              {...props}
            >
              {children}
            </blockquote>
          ),
          hr: (props) => <hr className="my-3 border-[var(--k-border)]" {...props} />,
          a: Anchor,
          strong: ({ children, ...props }) => (
            <strong className="font-semibold text-[var(--k-text)]" {...props}>
              {children}
            </strong>
          ),
          em: ({ children, ...props }) => (
            <em className="italic" {...props}>
              {children}
            </em>
          ),
          pre: ({ children, ...props }) => (
            <pre
              className="mb-2 overflow-x-auto rounded-lg border border-[var(--k-border)] bg-[#0a0a0a] p-3 text-xs last:mb-0"
              {...props}
            >
              {children}
            </pre>
          ),
          code: ({ className, children, ...props }) => {
            const isFenced = Boolean(className?.includes("language-"));
            if (isFenced) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-[rgba(127,127,127,0.22)] px-1 py-0.5 font-mono text-[0.85em]"
                {...props}
              >
                {children}
              </code>
            );
          },
          table: ({ children, ...props }) => (
            <div className="mb-2 max-w-full overflow-x-auto last:mb-0">
              <table className="min-w-full border-collapse border border-[var(--k-border)] text-xs" {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children, ...props }) => <thead {...props}>{children}</thead>,
          tbody: ({ children, ...props }) => <tbody {...props}>{children}</tbody>,
          tr: ({ children, ...props }) => <tr {...props}>{children}</tr>,
          th: ({ children, ...props }) => (
            <th
              className="border border-[var(--k-border)] bg-[var(--k-page-bg)] px-2 py-1.5 text-left font-semibold"
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="border border-[var(--k-border)] px-2 py-1.5 align-top" {...props}>
              {children}
            </td>
          ),
        }}
      >
        {trimmed}
      </Markdown>
    </div>
  );
}
