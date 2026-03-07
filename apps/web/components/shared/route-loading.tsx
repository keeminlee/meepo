type RouteLoadingProps = {
  label: string;
};

export function RouteLoading({ label }: RouteLoadingProps) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="rounded-2xl card-glass px-8 py-6 text-center">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Loading</div>
        <div className="mt-2 text-2xl font-serif italic">{label}</div>
      </div>
    </div>
  );
}
