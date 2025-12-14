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
const VERSION_V1 = 0x01; // Version 1: includes iteration count
const PBKDF2_ITERATIONS_LEGACY = 100000; // Legacy iteration count for v0 (pre-versioned) format
const PBKDF2_ITERATIONS_CURRENT = 600000; // Current OWASP-recommended iteration count
const PBKDF2_ITERATIONS_MIN = 100000; // Minimum allowed iterations for security
const PBKDF2_ITERATIONS_MAX = 10000000; // Maximum allowed iterations to prevent DoS

/**
 * Derive encryption key from the master key using PBKDF2
 */
async function deriveKey(salt: Buffer, masterKey: string, iterations: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(masterKey, salt, iterations, 32, 'sha256', (err, derivedKey) => {
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
 * Returns base64-encoded string containing: version + iterations + salt + iv + authTag + ciphertext
 * Version 1 format: 1 byte version + 4 bytes iterations + 32 bytes salt + 16 bytes iv + 16 bytes authTag + ciphertext
 */
export async function encrypt(plaintext: string | null | undefined): Promise<string | null> {
  if (!plaintext) {
    return null;
  }

  const masterKey = validateEncryptionKey();

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Derive key from master key using salt with current iteration count
  const key = await deriveKey(salt, masterKey, PBKDF2_ITERATIONS_CURRENT);
  
  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  // Encrypt
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  
  // Get auth tag
  const authTag = cipher.getAuthTag();
  
  // Create version and iteration count buffers
  const version = Buffer.from([VERSION_V1]);
  const iterations = Buffer.allocUnsafe(4);
  iterations.writeUInt32BE(PBKDF2_ITERATIONS_CURRENT, 0);
  
  // Combine: version + iterations + salt + iv + authTag + encrypted
  const combined = Buffer.concat([version, iterations, salt, iv, authTag, encrypted]);
  
  return combined.toString('base64');
}

/**
 * Check if data appears to be encrypted (base64 with correct length)
 */
function isEncrypted(data: string): boolean {
  try {
    const decoded = Buffer.from(data, 'base64');
    
    // Check for valid base64 encoding
    const isValidBase64 = Buffer.from(decoded.toString('base64'), 'base64').equals(decoded);
    if (!isValidBase64) {
      return false;
    }
    
    // Check minimum length and validate format-specific requirements
    if (decoded.length === 0) {
      return false;
    }
    
    // Check if v1 format
    const minLengthV1 = 1 + 4 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;
    if (decoded[0] === VERSION_V1) {
      return decoded.length >= minLengthV1;
    }
    
    // Check for legacy v0 format
    const minLengthV0 = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;
    return decoded.length >= minLengthV0;
  } catch {
    return false;
  }
}

/**
 * Decrypt encrypted text data
 * Supports both v1 format (version + iterations + salt + iv + authTag + ciphertext)
 * and legacy v0 format (salt + iv + authTag + ciphertext with 100k iterations)
 * Falls back to returning plaintext for legacy unencrypted data
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
    
    // Validate minimum buffer length
    if (combined.length === 0) {
      throw new Error('Invalid encrypted data: empty buffer');
    }
    
    // Check if this is v1 format (has version byte)
    let offset = 0;
    let iterations = PBKDF2_ITERATIONS_LEGACY; // Default to legacy count for v0 format
    
    // Detect format version
    const firstByte = combined[0];
    if (firstByte === VERSION_V1) {
      // V1 format: validate length and read iteration count
      const minLengthV1 = 1 + 4 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;
      if (combined.length < minLengthV1) {
        throw new Error('Invalid v1 encrypted data: buffer too short');
      }
      
      offset = 1; // Skip version byte
      iterations = combined.readUInt32BE(offset);
      offset += 4;
      
      // Validate iteration count to prevent DoS attacks
      if (iterations < PBKDF2_ITERATIONS_MIN || iterations > PBKDF2_ITERATIONS_MAX) {
        throw new Error(`Invalid iteration count: ${iterations} (must be between ${PBKDF2_ITERATIONS_MIN} and ${PBKDF2_ITERATIONS_MAX})`);
      }
    } else {
      // V0 format (legacy) - validate minimum length
      const minLengthV0 = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;
      if (combined.length < minLengthV0) {
        throw new Error('Invalid v0 encrypted data: buffer too short');
      }
    }
    
    // Extract components based on offset
    const salt = combined.subarray(offset, offset + SALT_LENGTH);
    const iv = combined.subarray(offset + SALT_LENGTH, offset + SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(
      offset + SALT_LENGTH + IV_LENGTH,
      offset + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
    );
    const ciphertext = combined.subarray(offset + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    
    // Validate extracted component lengths
    if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Invalid encrypted data: malformed component lengths');
    }
    
    // Derive key from master key using salt with the appropriate iteration count
    const key = await deriveKey(salt, masterKey, iterations);
    
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
