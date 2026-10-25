import { IconCheck, IconCopy } from "@tabler/icons-react";
import { Button } from "@vvedantb/ui";
import { useEffect, useRef, useState } from "react";

type CopyButtonProps = {
  text: string;
  label: string;
  children?: React.ReactNode;
  className?: string;
  variant?: "outline" | "ghost";
  size?: "sm" | "lg" | "default";
};

/** Copies `text`, then shows a check for two seconds. */
export function CopyButton({ text, label, children, className, variant = "outline", size = "default" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button type="button" variant={variant} size={size} className={className} onClick={copy} aria-label={label}>
      {children}
      {copied ? <IconCheck size={16} aria-hidden /> : <IconCopy size={16} aria-hidden />}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </Button>
  );
}
