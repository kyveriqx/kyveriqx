/* SMTP password encryption — AES-256-GCM at the app layer.

   The emailcampaign tool stores per-user SMTP credentials so the user
   only has to enter their host / username / password once. The password
   is sensitive (it logs into a real mailbox) so it MUST NOT live in
   plaintext in the database — even briefly, even behind RLS.

   We use Node's built-in `crypto` with AES-256-GCM, keyed by the
   `SMTP_ENCRYPTION_KEY` env var (32 bytes, base64-encoded). The key
   lives only on the server. The ciphertext + IV + auth tag go into the
   `user_smtp_credentials.password_enc` column; we pack tag onto the end
   of the ciphertext buffer so callers store one bytea instead of two.

   To generate a key:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

   To rotate the key: ship the migration script in scripts/rotate-smtp-key.mjs
   (not part of v1) — decrypt with the old key, re-encrypt with the new one,
   update the env, redeploy. */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LENGTH = 32; // bytes — AES-256
const IV_LENGTH = 12;  // bytes — GCM standard nonce
const TAG_LENGTH = 16; // bytes — GCM auth tag

function loadKey(): Buffer {
  const raw = process.env.SMTP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "SMTP_ENCRYPTION_KEY is not set. Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(${KEY_LENGTH}).toString('base64'))"`,
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("SMTP_ENCRYPTION_KEY must be base64-encoded.");
  }
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `SMTP_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length}).`,
    );
  }
  return key;
}

export type EncryptedSecret = {
  /** GCM ciphertext with the 16-byte auth tag appended. */
  ciphertext: Buffer;
  /** 12-byte nonce, unique per encryption. */
  iv: Buffer;
};

/** Encrypt a UTF-8 string. Generates a fresh random IV per call —
 *  never reuse an IV with the same key. Returns ciphertext (with auth
 *  tag suffix) and IV; callers persist both. */
export function encryptSmtpPassword(plaintext: string): EncryptedSecret {
  if (typeof plaintext !== "string") {
    throw new Error("encryptSmtpPassword: plaintext must be a string.");
  }
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([enc, tag]), iv };
}

/** Generic aliases — the same AES-256-GCM primitive is reused to protect
 *  other server-side secrets (e.g. the emailcampaign OAuth refresh token),
 *  not just SMTP passwords. Same key, same wire format; the alias just
 *  reads correctly at those call sites. */
export const encryptSecret = encryptSmtpPassword;

/** Inverse of encryptSmtpPassword. Throws if the ciphertext / tag has
 *  been tampered with (GCM authentication failure) — never silently
 *  returns garbled output. */
export function decryptSmtpPassword(ciphertext: Buffer, iv: Buffer): string {
  if (!Buffer.isBuffer(ciphertext) || ciphertext.length < TAG_LENGTH) {
    throw new Error("decryptSmtpPassword: ciphertext is missing or too short.");
  }
  if (!Buffer.isBuffer(iv) || iv.length !== IV_LENGTH) {
    throw new Error(`decryptSmtpPassword: IV must be ${IV_LENGTH} bytes.`);
  }
  const key = loadKey();
  const tag = ciphertext.subarray(ciphertext.length - TAG_LENGTH);
  const body = ciphertext.subarray(0, ciphertext.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(body), decipher.final()]);
  return dec.toString("utf8");
}

/** Generic alias — see encryptSecret. */
export const decryptSecret = decryptSmtpPassword;
