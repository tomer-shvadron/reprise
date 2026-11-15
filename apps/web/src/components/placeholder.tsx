import type { ReactNode } from 'react';

interface PlaceholderProps {
  title: string;
  /** The work package that replaces this stub, e.g. `WP-060`. */
  workPackage: string;
  children?: ReactNode;
}

/** What a phase 3 entry point shows until its work package fills it. */
export function Placeholder({ title, workPackage, children }: PlaceholderProps) {
  return (
    <div className="flex flex-col gap-1 p-3 text-sm">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h2>
      <p className="text-ink-muted">Placeholder: {workPackage} builds this.</p>
      {children}
    </div>
  );
}
