import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSmtpPassword, decryptSmtpPassword } from "../smtp-crypto";

describe("smtp-crypto — AES-GCM round trip", () => {
  beforeAll(() => {
    process.env.SMTP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("decrypts what it encrypted", () => {
    const samples = [
      "hunter2",
      "a-very-long-app-specific-password-1234567890",
      "with spaces and \"quotes\" and 'apostrophes'",
      "unicode: नमस्ते 你好 مرحبا",
      "", // empty string — degenerate but valid
    ];
    for (const s of samples) {
      const { ciphertext, iv } = encryptSmtpPassword(s);
      expect(decryptSmtpPassword(ciphertext, iv)).toBe(s);
    }
  });

  it("uses a fresh IV per call", () => {
    const a = encryptSmtpPassword("same-plaintext");
    const b = encryptSmtpPassword("same-plaintext");
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("rejects tampered ciphertext (GCM auth failure)", () => {
    const { ciphertext, iv } = encryptSmtpPassword("real-password");
    const tampered = Buffer.from(ciphertext);
    tampered[0] ^= 0xff; // flip a bit in the body
    expect(() => decryptSmtpPassword(tampered, iv)).toThrow();
  });

  it("rejects a wrong IV length", () => {
    const { ciphertext } = encryptSmtpPassword("x");
    expect(() => decryptSmtpPassword(ciphertext, Buffer.alloc(8))).toThrow(/IV/);
  });
});
