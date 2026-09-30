export function QueryError({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  const detail = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : null;
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <p className="font-medium text-destructive">{title}</p>
      {detail ? <p className="mt-1 break-words text-xs text-muted-foreground">{detail.slice(0, 200)}</p> : null}
      <button
        type="button"
        className="mt-3 text-sm font-medium text-primary underline-offset-4 hover:underline"
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}
