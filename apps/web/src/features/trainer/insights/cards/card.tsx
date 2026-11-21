import { useId, type ReactNode } from 'react';

/** One card of the insights panel: a heading and text first, with any picture as an extra. */
export function InsightCard({
  title,
  children,
  ...data
}: {
  title: string;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5 border-b px-3 py-2.5" {...data}>
      <h3
        id={id}
        className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase"
      >
        {title}
      </h3>
      {children}
    </section>
  );
}
