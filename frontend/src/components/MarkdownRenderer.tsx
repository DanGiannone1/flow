"use client";

import { useState, useCallback } from "react";
import { isValidElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Components } from "react-markdown";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

interface CitationSource {
  id: string;
  label: string;
}

type CodeElementProps = {
  className?: string;
  children?: ReactNode;
};

function getNodeText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join("");
  if (isValidElement<CodeElementProps>(node)) return getNodeText(node.props.children);
  return "";
}

function CodeBlock({ children, ...props }: React.ComponentPropsWithoutRef<"pre">) {
  const [copied, setCopied] = useState(false);
  const codeChild = Array.isArray(children) ? children[0] : children;
  const codeNode = isValidElement(codeChild) ? codeChild : null;
  const codeProps = isValidElement(codeNode) ? (codeNode.props as CodeElementProps) : {};
  const codeClassName = codeProps.className || "";
  const codeText = getNodeText(codeProps.children);
  const langMatch = codeClassName.match(/language-(\w+)/);
  const language = langMatch ? langMatch[1] : "text";

  const handleCopy = useCallback(() => {
    if (codeText) {
      navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }, [codeText]);

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{language}</span>
        <button type="button" onClick={handleCopy} className="code-block-copy">
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}

const markdownComponents: Components = {
  pre: CodeBlock,
};

function extractSourcesSection(content: string): { body: string; sources: CitationSource[] } {
  const match = content.match(/\n## Sources\s*\n([\s\S]*)$/);
  if (!match) return { body: content, sources: [] };

  const rawSources = match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const sources: CitationSource[] = [];
  for (const line of rawSources) {
    const sourceMatch = line.match(/^-\s+\[(S\d+)\]\s+(.+)$/);
    if (!sourceMatch) continue;
    sources.push({ id: sourceMatch[1], label: sourceMatch[2].trim() });
  }

  const body = content.slice(0, match.index).trimEnd();
  return { body, sources };
}

function linkifyInlineCitations(content: string, sourceIds: Set<string>): string {
  if (sourceIds.size === 0) return content;
  return content.replace(/\[(S\d+)\]/g, (full, id: string) => {
    if (!sourceIds.has(id)) return full;
    return `[\\[${id}\\]](#source-${id.toLowerCase()})`;
  });
}

export default function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  const { body, sources } = extractSourcesSection(content);
  const linkedBody = linkifyInlineCitations(body, new Set(sources.map((source) => source.id)));

  return (
    <div className={`prose prose-message ${className}`}>
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]} 
        rehypePlugins={[rehypeHighlight]} 
        components={markdownComponents}
      >
        {linkedBody}
      </ReactMarkdown>
      {sources.length > 0 && (
        <section className="citation-panel">
          <div className="citation-panel-header">Sources</div>
          <div className="citation-list">
            {sources.map((source) => (
              <a
                key={source.id}
                id={`source-${source.id.toLowerCase()}`}
                href={`#source-${source.id.toLowerCase()}`}
                className="citation-card"
              >
                <span className="citation-chip">[{source.id}]</span>
                <span className="citation-label">{source.label}</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
