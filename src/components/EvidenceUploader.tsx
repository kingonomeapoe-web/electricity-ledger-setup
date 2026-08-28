import { useRef, useState } from "react";
import { Camera, Images, Paperclip, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import {
  uploadEvidence,
  formatBytes,
  type EvidenceFile,
  type EvidenceType,
} from "@/lib/evidence";

type Props = {
  propertyId: string;
  evidenceType: EvidenceType;
  label?: string | undefined;
  hint?: string | undefined;
  disabled?: boolean | undefined;
  onUploaded: (evidence: EvidenceFile, file: File) => void | Promise<void>;
};

export function EvidenceUploader({
  propertyId,
  evidenceType,
  label = "Evidence",
  hint,
  disabled,
  onUploaded,
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<"idle" | "uploading" | "uploaded" | "failed">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ name: string; size: number | null } | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setState("uploading");
    setMeta({ name: file.name, size: file.size });
    if (file.type.startsWith("image/")) setPreview(URL.createObjectURL(file));
    try {
      const evidence = await uploadEvidence({ file, propertyId, evidenceType });
      setState("uploaded");
      await onUploaded(evidence, file);
    } catch (error) {
      setState("failed");
      toast.error(error instanceof Error ? error.message : "Upload failed");
    }
  }

  const busy = disabled || state === "uploading";

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {state !== "idle" ? <StatusBadge state={state} /> : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Button
          type="button"
          variant="default"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="mr-2 h-4 w-4" /> Take photo
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => galleryRef.current?.click()}
        >
          <Images className="mr-2 h-4 w-4" /> Choose from gallery
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip className="mr-2 h-4 w-4" /> Choose file
        </Button>
      </div>

      {/* Camera: opens the rear camera directly on Android/iOS */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {/* Gallery: image picker, no capture attribute */}
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {/* Any file, including PDF receipts */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {meta ? (
        <div className="mt-3 flex items-center gap-3 rounded-lg bg-muted/50 p-2.5">
          {preview ? (
            <img
              src={preview}
              alt="Selected evidence preview"
              className="h-14 w-14 rounded-md object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-md bg-muted">
              <Paperclip className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">{meta.name}</p>
            <p className="text-xs text-muted-foreground">{formatBytes(meta.size)}</p>
          </div>
          {state === "uploading" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {state === "uploaded" ? <CheckCircle2 className="h-4 w-4 text-chart-2" /> : null}
          {state === "failed" ? <XCircle className="h-4 w-4 text-destructive" /> : null}
        </div>
      ) : null}

      <p className="mt-3 text-xs text-muted-foreground">
        The original file is stored unchanged in private storage with its SHA-256 hash.
      </p>
    </div>
  );
}
