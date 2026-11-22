// =============================================================================
// Markdown.tsx : SAFE TEXT FORMATTING FOR ASSISTANT REPLIES
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   A small renderer for headings, lists, bold and links. It builds the page from plain text pieces and never inserts raw HTML, so a reply cannot inject anything.
// =============================================================================

"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";

/**
 * Small, safe Markdown renderer for assistant replies: headings, paragraphs,
 * lists, tables, bold/italic/code and links. Only in-app links (starting with
 * "/") are clickable; anything else renders as plain text. No raw HTML.
 */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      out.push(
        <p key={k++} className={h[1].length <= 2 ? "title mt-1 text-[15px] font-semibold text-ink" : "mt-1 text-[14px] font-semibold text-ink"}>
          {inline(h[2])}
        </p>,
      );
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={k++} className="-mx-1 overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-2">
                {head?.map((c, j) => (
                  <th key={j} className="whitespace-nowrap px-1.5 py-1.5 font-medium">
                    {inline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri} className="border-b border-line/60 last:border-0">
                  {r.map((c, j) => (
                    <td key={j} className="tabular px-1.5 py-1.5 align-top">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: { depth: number; text: string }[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/)!;
        items.push({ depth: m[1].length >= 2 ? 1 : 0, text: m[3] });
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      out.push(
        <Tag key={k++} className={ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5 marker:text-ink-3"}>
          {items.map((it, j) => (
            <li key={j} className={it.depth ? "ml-4" : undefined}>
              {inline(it.text)}
            </li>
          ))}
        </Tag>,
      );
      continue;
    }
    // Always consume at least one line so a half-streamed table row or odd
    // syntax can never stall the loop.
    const para: string[] = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s+|\s*([-*•]|\d+[.)])\s+|\s*\|.*\|\s*$)/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={k++}>{breaks(para.join("\n"))}</p>);
  }
  return <div className="space-y-2.5 text-[14px] leading-relaxed text-ink">{out}</div>;
}

/**
 * Inline text where each newline is a real line break, so notes and drafts keep
 * their line structure (e.g. one SOAP line per row). Bold, code and links still apply.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  return <span className={className}>{breaks(text)}</span>;
}

function breaks(text: string): ReactNode[] {
  return text.replace(/\r/g, "").split("\n").map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {inline(line)}
    </Fragment>
  ));
}

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![*\w])\*[^*\s][^*]*\*(?!\*)|(?<!\w)_[^_\s][^_]*_(?!\w))/g;

function inline(s: string): ReactNode[] {
  const parts = s.split(TOKEN).filter((p) => p !== "" && p != null);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="font-semibold">{inline(p.slice(2, -2))}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="rounded bg-canvas px-1 py-0.5 font-mono text-[12px]">{p.slice(1, -1)}</code>;
    const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const href = link[2];
      return href.startsWith("/") && !href.startsWith("//") ? (
        <Link key={i} href={href} className="font-medium text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand">
          {link[1]}
        </Link>
      ) : (
        <span key={i}>{link[1]}</span>
      );
    }
    if ((p.startsWith("*") && p.endsWith("*")) || (p.startsWith("_") && p.endsWith("_"))) return <em key={i}>{p.slice(1, -1)}</em>;
    return <span key={i}>{p}</span>;
  });
}
