// File storage on AWS S3.
//
// No SDK: requests are signed with AWS Signature V4 using only Node's
// `crypto` module, following the "use fetch, no SDK" philosophy adopted for
// the project's other integrations. Binary data never goes into Postgres;
// only the S3 key is stored in the metadata.
//
// Environment variables: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION,
// AWS_BUCKET_NAME. If they are not set, isS3Configured() returns false and
// the upload route responds with a clear message (without breaking the build).

import { createHash, createHmac } from "crypto";

const SERVICE = "s3";

function cfg() {
  return {
    accessKey: process.env.AWS_ACCESS_KEY_ID,
    secretKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION ?? "us-east-1",
    bucket: process.env.AWS_BUCKET_NAME,
  };
}

export function isS3Configured(): boolean {
  const c = cfg();
  return Boolean(c.accessKey && c.secretKey && c.bucket);
}

function hostFor(bucket: string, region: string): string {
  // Virtual-hosted style. us-east-1 also accepts the regionalized host.
  return `${bucket}.s3.${region}.amazonaws.com`;
}

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

function amzDate(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

function encodeKey(key: string): string {
  // Encodes each segment while preserving the path slashes.
  return key
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
}

/** PUTs an object to S3. Throws on error. Returns the key. */
export async function uploadToS3(opts: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<string> {
  const c = cfg();
  if (!c.accessKey || !c.secretKey || !c.bucket) {
    throw new Error("S3 não configurado (AWS_* ausentes).");
  }
  const host = hostFor(c.bucket, c.region);
  const { amzDate: amz, dateStamp } = amzDate();
  const canonicalUri = `/${encodeKey(opts.key)}`;
  const payloadHash = sha256Hex(opts.body);

  const canonicalHeaders =
    `content-type:${opts.contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amz}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${c.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256", amz, scope, sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = createHmac("sha256", signingKey(c.secretKey, dateStamp, c.region))
    .update(stringToSign)
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: "PUT",
    headers: {
      "content-type": opts.contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amz,
      authorization,
    },
    body: new Uint8Array(opts.body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`S3 PUT ${res.status}: ${detail.slice(0, 300)}`);
  }
  return opts.key;
}

/** Generates a presigned GET URL (query string) valid for `expires` seconds. */
export function presignGetUrl(key: string, expires = 3600): string | null {
  const c = cfg();
  if (!c.accessKey || !c.secretKey || !c.bucket) return null;

  const host = hostFor(c.bucket, c.region);
  const { amzDate: amz, dateStamp } = amzDate();
  const canonicalUri = `/${encodeKey(key)}`;
  const scope = `${dateStamp}/${c.region}/${SERVICE}/aws4_request`;

  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${c.accessKey}/${scope}`,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  });

  const canonicalRequest = [
    "GET", canonicalUri, params.toString(),
    `host:${host}\n`, "host", "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256", amz, scope, sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = createHmac("sha256", signingKey(c.secretKey, dateStamp, c.region))
    .update(stringToSign)
    .digest("hex");

  params.append("X-Amz-Signature", signature);
  return `https://${host}${canonicalUri}?${params.toString()}`;
}

/** Fetches an object from S3 and returns it as base64 (via presigned URL). */
export async function fetchObjectBase64(key: string): Promise<string | null> {
  const url = presignGetUrl(key, 300);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch {
    return null;
  }
}
