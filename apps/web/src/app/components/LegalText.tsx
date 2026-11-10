import type { ReactNode } from "react";

/** Minimal markdown renderer for legal documents: headings, bullet lists and paragraphs. Text only; no HTML is interpreted. */
export function LegalText({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) { blocks.push(<p key={blocks.length}>{paragraph.join(" ")}</p>); paragraph = []; }
    if (list.length) { blocks.push(<ul key={blocks.length}>{list.map((item, i) => <li key={i}>{item}</li>)}</ul>); list = []; }
  };
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      blocks.push(level === 1 ? <h1 key={blocks.length}>{heading[2]}</h1> : level === 2 ? <h2 key={blocks.length}>{heading[2]}</h2> : <h3 key={blocks.length}>{heading[2]}</h3>);
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) { if (paragraph.length) flush(); list.push(trimmed.replace(/^[-*]\s+/, "")); continue; }
    if (list.length) flush();
    paragraph.push(trimmed);
  }
  flush();
  return <div className="legal-text">{blocks}</div>;
}
