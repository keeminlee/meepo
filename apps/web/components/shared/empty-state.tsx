type EmptyStateProps = {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
};

export function EmptyState(props: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl card-glass p-12 text-center">
      <h2 className="text-2xl font-serif italic text-foreground">{props.title}</h2>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground">{props.description}</p>
      {props.actionHref && props.actionLabel ? (
        <a href={props.actionHref} className="mt-6 rounded-full button-primary px-5 py-2 text-xs font-bold uppercase tracking-widest">
          {props.actionLabel}
        </a>
      ) : null}
    </div>
  );
}
