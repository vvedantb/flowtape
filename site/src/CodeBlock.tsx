import { landingPanelClass } from "@vvedantb/ui";
import { CopyButton } from "./CopyButton";

type CodeBlockProps = {
  title: string;
  code: string;
  /** Show a Copy button for `code`. */
  copy?: boolean;
};

export function CodeBlock({ title, code, copy = false }: CodeBlockProps) {
  return (
    <div className={landingPanelClass}>
      <div className="flex h-10 items-center justify-between border-b border-separator px-4 font-mono text-xs text-muted">
        <span className="truncate">{title}</span>
        {copy ? (
          <CopyButton text={code} label={`Copy: ${title}`} variant="ghost" size="sm" className="-mr-2 h-7 px-2 text-xs" />
        ) : null}
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[0.8125rem] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}
