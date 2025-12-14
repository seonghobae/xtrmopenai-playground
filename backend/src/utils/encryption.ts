/**
 * Encryption utilities for sensitive data storage
 * Uses AES-256-GCM for authenticated encryption
 */

import * as crypto from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits

/**
 * Derives a 256-bit key from the session secret using PBKDF2
 */
function deriveKey(salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(
    config.security.session_secret,
    salt,
    100000, // iterations
    32, // key length (256 bits)
    'sha256'
  );
}

/**
 * Encrypts data using AES-256-GCM
 * Returns base64-encoded string containing: salt || iv || authTag || ciphertext
 */
export function encrypt(data: string): string {
  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Derive encryption key
  const key = deriveKey(salt);
  
  // Encrypt
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(data, 'utf8'),
    cipher.final(),
  ]);
  
  // Get auth tag
  const authTag = cipher.getAuthTag();
  
  // Combine: salt || iv || authTag || ciphertext
  const combined = Buffer.concat([salt, iv, authTag, encrypted]);
  
  return combined.toString('base64');
}

/**
 * Decrypts data encrypted with encrypt()
 * Expects base64-encoded string containing: salt || iv || authTag || ciphertext
 */
export function decrypt(encryptedData: string): string {
  // Decode from base64
  const combined = Buffer.from(encryptedData, 'base64');
  
  // Extract components
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  
  // Derive decryption key
  const key = deriveKey(salt);
  
  // Decrypt
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  
  return decrypted.toString('utf8');
}

/**
 * Encrypts a JSON object
 */
export function encryptJson(obj: Record<string, unknown>): string {
  return encrypt(JSON.stringify(obj));
}

/**
 * Decrypts and parses a JSON object
 */
export function decryptJson(encryptedData: string): Record<string, unknown> {
  const decrypted = decrypt(encryptedData);
  return JSON.parse(decrypted) as Record<string, unknown>;
}
