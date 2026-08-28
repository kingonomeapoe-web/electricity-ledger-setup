import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";

import { getEvidenceSignedUrl } from "@/lib/evidence";

/** Inline preview of private evidence, always through a short-lived signed URL. */
export function EvidencePreview({
  storagePath,
  mimeType,
  filename,
  className,
}: {
  storagePath: string | null | undefined;
  mimeType?: string | null | undefined;
  filename?: string | null | undefined;
  className?: string | undefined;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setError(null);
    if (!storagePath) return;
    getEvidenceSignedUrl(storagePath, 600)
      .then((signed) => alive && setUrl(signed))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [storagePath]);

  if (!storagePath) {
    return <p className="text-xs text-muted-foreground">No evidence attached.</p>;
  }
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!url) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-border bg-muted/40">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isImage = (mimeType ?? "").startsWith("image/");

  return (
    <div className={className}>
      {isImage ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={filename ?? "Evidence"}
            className="max-h-[420px] w-full rounded-lg border border-border object-contain bg-muted/30"
          />
        </a>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm underline"
        >
          <FileText className="h-4 w-4" /> {filename ?? "Open original evidence"}
        </a>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        Original file, unmodified · signed link expires in 10 minutes
      </p>
    </div>
  );
}
