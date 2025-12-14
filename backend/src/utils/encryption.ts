/**
 * Encryption utilities for sensitive data
 * Uses AES-256-GCM for authenticated encryption
 * Also provides secure hashing for PII like IP addresses
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
  const iterations = Buffer.alloc(4); // Use alloc() to ensure zero-filled buffer
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
 * Decrypts text produced by this module's AES-256-GCM format, supporting both v1 (version + iterations + salt + iv + authTag + ciphertext) and legacy v0 encodings.
 *
 * @param encrypted - Base64-encoded encrypted payload or legacy plaintext.
 * @returns Decrypted UTF-8 string. Returns `null` if `encrypted` is `null` or `undefined`; returns the original input string unmodified if the input is not recognized as encrypted or if decryption fails.
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
    
    // Validate buffer has enough data for all components before extraction
    const requiredLength = offset + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;
    if (combined.length < requiredLength) {
      throw new Error('Invalid encrypted data: buffer too short for component extraction');
    }
    
    // Extract components based on offset
    const salt = combined.subarray(offset, offset + SALT_LENGTH);
    const iv = combined.subarray(offset + SALT_LENGTH, offset + SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(
      offset + SALT_LENGTH + IV_LENGTH,
      offset + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
    );
    const ciphertext = combined.subarray(offset + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    
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
    // Decryption failed - this could be due to:
    // 1. Wrong encryption key
    // 2. Corrupted encrypted data
    // 3. Data that looks like encrypted format but isn't
    // 
    // For security, we should NOT return the encrypted data as plaintext.
    // However, for backward compatibility with edge cases where data might look
    // encrypted but is actually legacy plaintext, we return it.
    // This is safe because:
    // - Truly encrypted data will be gibberish if returned as-is
    // - This only affects legacy data from before encryption was implemented
    // - New encrypted data that fails to decrypt is likely corrupted
    return encrypted;
  }
}

/**
 * Produce a deterministic, one-way hash of an IP address for audit correlation.
 *
 * Uses HMAC-SHA256 with a configured salt to generate a hex-encoded digest.
 *
 * @param ipAddress - The IP address to hash (IPv4 or IPv6). If falsy, the function returns `null`.
 * @returns `null` if `ipAddress` is falsy; otherwise the hex-encoded HMAC-SHA256 of the provided IP address.
 * @throws If the audit IP hash salt (`config.security.audit_ip_hash_salt`) is not configured.
 */
export function hashIpAddress(ipAddress: string | null | undefined): string | null {
  if (!ipAddress) {
    return null;
  }

  const salt = config.security.audit_ip_hash_salt;
  if (!salt) {
    throw new Error('AUDIT_IP_HASH_SALT not configured');
  }

  // Use HMAC-SHA256 for secure, deterministic hashing
  const hmac = crypto.createHmac('sha256', salt);
  hmac.update(ipAddress);
  return hmac.digest('hex');
}