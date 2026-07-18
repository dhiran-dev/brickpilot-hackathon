import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

const MAX_REFERENCE_BYTES = 1_000_000;
const MAX_RENDER_BYTES = 20_000_000;
const DATA_URI_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

export type StoredAsset = { storageKey: string; url: string; contentType: string; bytes: number; checksum: string };
export type AssetWriteResult<T> = {
  stored: Array<{ index: number; value: T }>;
  failures: Array<{ index: number; reason: unknown }>;
};

function config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 asset storage is not fully configured");
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

function client() {
  const value = config();
  return new S3Client({
    region: "auto",
    endpoint: `https://${value.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: value.accessKeyId, secretAccessKey: value.secretAccessKey },
  });
}

function safeStorageKey(value: string) {
  if (!/^[a-zA-Z0-9/_-]+\.(?:png|jpe?g|webp)$/.test(value) || value.includes("..")) throw new Error("Invalid asset storage key");
  return value;
}

async function put(storageKey: string, body: Uint8Array, contentType: string): Promise<StoredAsset> {
  const value = config();
  const key = safeStorageKey(storageKey);
  await client().send(new PutObjectCommand({ Bucket: value.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
  const path = key.split("/").map(encodeURIComponent).join("/");
  return { storageKey: key, url: `/api/assets/${path}`, contentType, bytes: body.byteLength, checksum: sha256Hex(body) };
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function decodeReferenceDataUri(dataUri: string) {
  const match = DATA_URI_PATTERN.exec(dataUri);
  if (!match) throw new Error("Reference images must be PNG, JPEG or WebP data URIs");
  const bytes = Uint8Array.from(Buffer.from(match[2], "base64"));
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REFERENCE_BYTES) throw new Error(`Reference image must be between 1 byte and ${MAX_REFERENCE_BYTES} bytes`);
  return { bytes, contentType: match[1] };
}

export async function storeReferenceDataUri(dataUri: string, storageKey: string) {
  const decoded = decodeReferenceDataUri(dataUri);
  return put(storageKey, decoded.bytes, decoded.contentType);
}

export async function storeRemoteRender(sourceUrl: string, storageKey: string) {
  const parsed = new URL(sourceUrl);
  const isReplicateHost = parsed.hostname === "replicate.delivery" || parsed.hostname.endsWith(".replicate.delivery");
  if (parsed.protocol !== "https:" || !isReplicateHost) throw new Error("Unexpected Replicate output host");
  const response = await fetch(parsed, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to download Replicate output (${response.status})`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "image/webp";
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(contentType)) throw new Error(`Unexpected render content type: ${contentType}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_RENDER_BYTES) throw new Error("Replicate output exceeds the durable storage limit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RENDER_BYTES) throw new Error("Replicate output is empty or too large");
  return put(storageKey, bytes, contentType);
}

export async function readStoredAsset(storageKey: string) {
  const value = config();
  const key = safeStorageKey(storageKey);
  const response = await client().send(new GetObjectCommand({ Bucket: value.bucket, Key: key }));
  if (!response.Body) throw new Error("Stored asset body is unavailable");
  const bytes = new Uint8Array(await response.Body.transformToByteArray());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RENDER_BYTES) throw new Error("Stored asset is empty or too large");
  return { bytes, contentType: response.ContentType ?? "application/octet-stream", etag: response.ETag };
}

export async function settleAssetWrites<T>(writes: Array<() => Promise<T>>): Promise<AssetWriteResult<T>> {
  const settled = await Promise.allSettled(writes.map((write) => write()));
  return settled.reduce<AssetWriteResult<T>>((result, item, index) => {
    if (item.status === "fulfilled") result.stored.push({ index, value: item.value });
    else result.failures.push({ index, reason: item.reason });
    return result;
  }, { stored: [], failures: [] });
}

export async function deleteStoredAssetExact(storageKey: string) {
  const value = config();
  const key = safeStorageKey(storageKey);
  await client().send(new DeleteObjectCommand({ Bucket: value.bucket, Key: key }));
  return key;
}

export async function deleteStoredAssetsExact(
  storageKeys: readonly string[],
  deleteOne: (storageKey: string) => Promise<unknown> = deleteStoredAssetExact,
) {
  const keys = [...new Set(storageKeys)].sort();
  const settled = await Promise.allSettled(keys.map(async (key) => {
    safeStorageKey(key);
    await deleteOne(key);
    return key;
  }));
  return settled.reduce<{ deleted: string[]; failed: Array<{ storageKey: string; reason: string }> }>((result, item, index) => {
    if (item.status === "fulfilled") result.deleted.push(item.value);
    else result.failed.push({
      storageKey: keys[index],
      reason: item.reason instanceof Error ? item.reason.message : String(item.reason),
    });
    return result;
  }, { deleted: [], failed: [] });
}

export async function compensateStoredAssets(assets: readonly Pick<StoredAsset, "storageKey">[]) {
  return deleteStoredAssetsExact(assets.map((asset) => asset.storageKey));
}
