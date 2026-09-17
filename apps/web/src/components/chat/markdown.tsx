"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Agent messages: GitHub-flavoured Markdown. Raw HTML is never rendered. */
const components: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  h1: ({ children }) => <p className="mt-2.5 mb-1 text-[17px] font-semibold first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mt-2.5 mb-1 text-base font-semibold first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mt-2 mb-1 font-semibold first:mt-0">{children}</p>,
  h4: ({ children }) => <p className="mt-2 mb-1 font-semibold first:mt-0">{children}</p>,
  blockquote: ({ children }) => <blockquote className="my-1.5 border-l-2 border-current/30 pl-3 opacity-90">{children}</blockquote>,
  hr: () => <hr className="my-2.5 border-current/15" />,
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-xl bg-bg/70 p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre first:mt-0 last:mb-0">
      {children}
    </pre>
  ),
  code: ({ children, className }) =>
    className?.startsWith("language-") ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded-md bg-bg/60 px-1 py-0.5 font-mono text-[0.88em]">{children}</code>
    ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-current/20 px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-current/10 px-2 py-1 align-top">{children}</td>,
  img: ({ alt, src }) =>
    typeof src === "string" ? (
      <a href={src} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
        {alt || src}
      </a>
    ) : null,
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
});
