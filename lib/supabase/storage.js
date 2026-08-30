import { supabase } from "./client";

const BUCKET = "project-images";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB, matches the bucket's server-side limit

const EXT_BY_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export function validateImageFile(file) {
  if (!file) return "No file selected.";
  if (!ALLOWED_TYPES.includes(file.type)) {
    return "Unsupported file type. Use JPEG, PNG, WEBP, or AVIF.";
  }
  if (file.size > MAX_SIZE_BYTES) {
    return "File is too large. Maximum size is 5MB.";
  }
  return null;
}

// Generates a safe, unpredictable storage path — never trusts the original filename.
export async function uploadProjectImage(slug, file) {
  if (!supabase) {
    throw new Error("Supabase is not configured — image was not uploaded.");
  }
  const validationError = validateImageFile(file);
  if (validationError) throw new Error(validationError);

  const ext = EXT_BY_TYPE[file.type];
  const path = `${slug || "project"}-${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(`Image upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Best-effort cleanup so deleting a project doesn't leave an orphaned image.
// Silently no-ops for thumbnails that aren't in our bucket (e.g. the static
// Phase A /public paths) — those aren't ours to delete.
export async function deleteProjectImageByUrl(url) {
  if (!supabase || !url) return;
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = url.slice(idx + marker.length);
  await supabase.storage.from(BUCKET).remove([path]);
}
