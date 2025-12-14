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
function deriveKey(salt: Buffer, masterKey: string): Buffer {
  return crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha256');
}

/**
 * Encrypt sensitive text data
 * Returns base64-encoded string containing: salt + iv + authTag + ciphertext
 */
export function encrypt(plaintext: string | null | undefined): string | null {
  if (!plaintext) {
    return null;
  }

  const masterKey = config.encryption.key;
  if (!masterKey) {
    throw new Error('ENCRYPTION_KEY not configured');
  }

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Derive key from master key using salt
  const key = deriveKey(salt, masterKey);
  
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
 * Decrypt encrypted text data
 * Expects base64-encoded string containing: salt + iv + authTag + ciphertext
 */
export function decrypt(encrypted: string | null | undefined): string | null {
  if (!encrypted) {
    return null;
  }

  const masterKey = config.encryption.key;
  if (!masterKey) {
    throw new Error('ENCRYPTION_KEY not configured');
  }

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
    const key = deriveKey(salt, masterKey);
    
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
    throw new Error(`Decryption failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}
