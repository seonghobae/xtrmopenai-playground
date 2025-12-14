/**
 * Encryption utilities for sensitive data
 * Uses AES-256-GCM for authenticated encryption
 */

import crypto from 'crypto';
import { config } from '../config/index.js';
import { logger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

// Rate limiting for legacy data warnings to prevent log flooding
const legacyDataWarningCache = new Set<string>();
const LEGACY_WARNING_CACHE_MAX_SIZE = 1000;

/**
 * Derive encryption key from the master key using PBKDF2
 */
async function deriveKey(salt: Buffer, masterKey: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(masterKey, salt, 100000, 32, 'sha256', (err, derivedKey) => {
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
 * 
 * **Backward Compatibility Fallback:**
 * - Returns plaintext as-is for legacy unencrypted data (detected via isEncrypted check)
 * - Returns null on decryption failure to prevent exposing encrypted data to application code
 * - Emits warning logs when fallback behavior is triggered (rate-limited to prevent log flooding)
 * 
 * **Migration Plan:**
 * - All new data is encrypted using the encrypt() function
 * - Legacy plaintext data is gradually encrypted when updated through normal operations
 * - Monitor warning logs to track migration progress
 * - Plan to remove fallback behavior after sufficient migration period (e.g., 6-12 months)
 */
export async function decrypt(encrypted: string | null | undefined): Promise<string | null> {
  if (!encrypted) {
    return null;
  }

  // Check if this looks like encrypted data
  if (!isEncrypted(encrypted)) {
    // Legacy plaintext data - return as-is for backward compatibility
    // Rate-limit warnings to prevent log flooding
    // Use hash to avoid exposing sensitive data in cache keys
    const hash = crypto.createHash('sha256').update(encrypted).digest('hex');
    const cacheKey = `legacy_${hash}`;
    if (!legacyDataWarningCache.has(cacheKey)) {
      logger.warn('Decrypting legacy plaintext data - migration needed');
      legacyDataWarningCache.add(cacheKey);
      
      // Prevent cache from growing indefinitely by removing oldest entry (simple FIFO)
      if (legacyDataWarningCache.size > LEGACY_WARNING_CACHE_MAX_SIZE) {
        const firstKey = legacyDataWarningCache.values().next().value;
        legacyDataWarningCache.delete(firstKey);
      }
    }
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
    // Decryption failed - return null to signal failure
    // Returning the encrypted data would be a security risk as it could expose encrypted content
    logger.warn('Decryption failed - returning null (possible corruption or invalid format)');
    return null;
  }
}
