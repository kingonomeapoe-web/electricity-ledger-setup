import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type EvidenceType = Database["public"]["Enums"]["evidence_type"];
export type EvidenceFile = Database["public"]["Tables"]["evidence_files"]["Row"];

export const EVIDENCE_BUCKET = "electricity-evidence";

/** Upload lifecycle states surfaced in the UI. */
export type EvidenceState =
  | "idle"
  | "uploading"
  | "uploaded"
  | "processing"
  | "ocr_complete"
  | "needs_review"
  | "confirmed"
  | "rejected"
  | "failed";

export async function sha256Hex(file: File): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const buf = await file.arrayBuffer();
    const digest = await globalThis.crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

/**
 * Uploads the ORIGINAL, unmodified file to the private evidence bucket and
 * records it in evidence_files. Paths are unique per upload, so nothing is
 * ever overwritten.
 */
export async function uploadEvidence(params: {
  file: File;
  propertyId: string;
  evidenceType: EvidenceType;
  capturedAt?: string | null;
}): Promise<EvidenceFile> {
  const { file, propertyId, evidenceType } = params;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("You must be signed in to upload evidence.");

  const hash = await sha256Hex(file);
  const capturedAt =
    params.capturedAt ??
    (file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString());

  const path = `${propertyId}/${evidenceType}/${globalThis.crypto.randomUUID()}-${safeName(file.name || "capture.jpg")}`;

  const { error: uploadError } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || "application/octet-stream",
    cacheControl: "3600",
  });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data, error } = await supabase
    .from("evidence_files")
    .insert({
      property_id: propertyId,
      uploaded_by: userData.user.id,
      evidence_type: evidenceType,
      storage_bucket: EVIDENCE_BUCKET,
      storage_path: path,
      original_filename: file.name || null,
      mime_type: file.type || null,
      file_size_bytes: file.size,
      sha256_hash: hash,
      captured_at: capturedAt,
    })
    .select()
    .single();

  if (error) {
    // Keep storage tidy if the metadata row was rejected (e.g. by RLS).
    await supabase.storage.from(EVIDENCE_BUCKET).remove([path]);
    throw new Error(`Could not record evidence: ${error.message}`);
  }

  return data;
}

/** Private bucket -> always view through a short-lived signed URL. */
export async function getEvidenceSignedUrl(storagePath: string, expiresIn = 300) {
  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export function formatBytes(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
