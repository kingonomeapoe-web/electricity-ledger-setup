import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getEvidenceSignedUrl } from "@/lib/evidence";

export function EvidenceViewer({
  storagePath,
  filename,
  mimeType,
  label = "View evidence",
}: {
  storagePath: string;
  filename?: string | null;
  mimeType?: string | null;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function show() {
    setLoading(true);
    try {
      setUrl(await getEvidenceSignedUrl(storagePath));
      setOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open evidence");
    } finally {
      setLoading(false);
    }
  }

  const isImage = (mimeType ?? "").startsWith("image/");

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => void show()} disabled={loading}>
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Eye className="mr-2 h-4 w-4" />
        )}
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate">{filename ?? "Evidence"}</DialogTitle>
          </DialogHeader>
          {url ? (
            isImage ? (
              <img src={url} alt={filename ?? "Evidence"} className="max-h-[70vh] w-full rounded-lg object-contain" />
            ) : (
              <a href={url} target="_blank" rel="noreferrer" className="text-sm underline">
                Open file in a new tab (signed link, expires shortly)
              </a>
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
