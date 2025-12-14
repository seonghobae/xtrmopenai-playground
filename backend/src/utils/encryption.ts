/**
 * Encryption utilities for sensitive data
 * Uses AES-256-GCM for authenticated encryption
 */

import crypto from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * Derive encryption key from the master key using PBKDF2
 */
async function deriveKey(salt: Buffer, masterKey: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(masterKey, salt, 600000, 32, 'sha256', (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Validate encryption key is configured
 */
function validateEncryptionKey(): string {
  const key = config.encryption.key;
  if (!key) {
    throw new Error('ENCRYPTION_KEY not configured');
  }
  return key;
}

/**
 * Encrypt sensitive text data
 * Returns base64-encoded string containing: salt + iv + authTag + ciphertext
 */
export async function encrypt(plaintext: string | null | undefined): Promise<string | null> {
  if (!plaintext) {
    return null;
  }

  const masterKey = validateEncryptionKey();

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Derive key from master key using salt
  const key = await deriveKey(salt, masterKey);
  
  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  // Encrypt
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  
  // Get auth tag
  const authTag = cipher.getAuthTag();
  
  // Combine: salt + iv + authTag + encrypted
  const combined = Buffer.concat([salt, iv, authTag, encrypted]);
  
  return combined.toString('base64');
}

/**
 * Check if data appears to be encrypted (base64 with correct length)
 */
function isEncrypted(data: string): boolean {
  try {
    const decoded = Buffer.from(data, 'base64');
    // Encrypted data must have at least: salt + iv + authTag + some ciphertext
    const minLength = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;
    return decoded.length >= minLength && Buffer.from(decoded.toString('base64'), 'base64').equals(decoded);
  } catch {
    return false;
  }
}

/**
 * Decrypt encrypted text data
 * Expects base64-encoded string containing: salt + iv + authTag + ciphertext
 * Falls back to returning plaintext for legacy data that isn't encrypted
 */
export async function decrypt(encrypted: string | null | undefined): Promise<string | null> {
  if (!encrypted) {
    return null;
  }

  // Check if this looks like encrypted data
  if (!isEncrypted(encrypted)) {
    // Legacy plaintext data - return as-is for backward compatibility
    return encrypted;
  }

  const masterKey = validateEncryptionKey();

  try {
    // Decode from base64
    const combined = Buffer.from(encrypted, 'base64');
    
    // Extract components
    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(
      SALT_LENGTH + IV_LENGTH,
      SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
    );
    const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    
    // Derive key from master key using salt
    const key = await deriveKey(salt, masterKey);
    
    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    
    return decrypted.toString('utf8');
  } catch (err) {
    // Decryption failed - this might be corrupted data or invalid encryption
    // Return plaintext as fallback for edge cases
    return encrypted;
  }
}
