/**
 * Unit tests for encryption utilities
 * Tests for hashIpAddress function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// Mock the config module before importing the function under test
vi.mock('../config/index.js', () => {
  return {
    config: {
      security: {
        audit_ip_hash_salt: 'test-salt-32-characters-long!!',
      },
    },
  };
});

// Import after mocking
import { hashIpAddress } from './encryption.js';
import * as configModule from '../config/index.js';

describe('hashIpAddress', () => {
  let originalSalt: string;

  beforeEach(() => {
    // Save original salt value
    originalSalt = configModule.config.security.audit_ip_hash_salt;
  });

  afterEach(() => {
    // Restore original salt value
    configModule.config.security.audit_ip_hash_salt = originalSalt;
  });

  describe('deterministic HMAC-SHA256 hashing', () => {
    it('should produce deterministic hex output for a sample IPv4 address', () => {
      // Set a known salt
      const knownSalt = 'test-salt-32-characters-long!!';
      configModule.config.security.audit_ip_hash_salt = knownSalt;

      const testIp = '192.168.1.1';
      
      // Calculate expected HMAC-SHA256 hash
      const expectedHmac = crypto.createHmac('sha256', knownSalt);
      expectedHmac.update(testIp);
      const expectedHash = expectedHmac.digest('hex');

      const result = hashIpAddress(testIp);

      expect(result).toBe(expectedHash);
      expect(result).toMatch(/^[0-9a-f]{64}$/); // SHA-256 produces 64 hex characters
    });

    it('should produce deterministic hex output for a sample IPv6 address', () => {
      const knownSalt = 'test-salt-32-characters-long!!';
      configModule.config.security.audit_ip_hash_salt = knownSalt;

      const testIp = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
      
      // Calculate expected HMAC-SHA256 hash
      const expectedHmac = crypto.createHmac('sha256', knownSalt);
      expectedHmac.update(testIp);
      const expectedHash = expectedHmac.digest('hex');

      const result = hashIpAddress(testIp);

      expect(result).toBe(expectedHash);
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce consistent output for the same IP address with same salt', () => {
      const knownSalt = 'consistent-salt-for-testing!!';
      configModule.config.security.audit_ip_hash_salt = knownSalt;

      const testIp = '10.0.0.1';
      
      const hash1 = hashIpAddress(testIp);
      const hash2 = hashIpAddress(testIp);
      const hash3 = hashIpAddress(testIp);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce different hashes for different IP addresses', () => {
      const knownSalt = 'test-salt-32-characters-long!!';
      configModule.config.security.audit_ip_hash_salt = knownSalt;

      const ip1 = '192.168.1.1';
      const ip2 = '192.168.1.2';
      
      const hash1 = hashIpAddress(ip1);
      const hash2 = hashIpAddress(ip2);

      expect(hash1).not.toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
      expect(hash2).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce different hashes for the same IP with different salts', () => {
      const testIp = '192.168.1.1';
      
      // First hash with first salt
      configModule.config.security.audit_ip_hash_salt = 'salt-one-32-characters-long!!!!';
      const hash1 = hashIpAddress(testIp);

      // Second hash with different salt
      configModule.config.security.audit_ip_hash_salt = 'salt-two-32-characters-long!!!!';
      const hash2 = hashIpAddress(testIp);

      expect(hash1).not.toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
      expect(hash2).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('error handling for missing salt configuration', () => {
    it('should throw error when audit_ip_hash_salt is empty string', () => {
      configModule.config.security.audit_ip_hash_salt = '';

      expect(() => hashIpAddress('192.168.1.1')).toThrow('AUDIT_IP_HASH_SALT not configured');
    });

    it('should throw error when audit_ip_hash_salt is undefined', () => {
      // @ts-expect-error - Testing runtime behavior with undefined
      configModule.config.security.audit_ip_hash_salt = undefined;

      expect(() => hashIpAddress('192.168.1.1')).toThrow('AUDIT_IP_HASH_SALT not configured');
    });

    it('should throw error when audit_ip_hash_salt is null', () => {
      // @ts-expect-error - Testing runtime behavior with null
      configModule.config.security.audit_ip_hash_salt = null;

      expect(() => hashIpAddress('192.168.1.1')).toThrow('AUDIT_IP_HASH_SALT not configured');
    });
  });

  describe('null and undefined IP address handling', () => {
    it('should return null when IP address is null', () => {
      configModule.config.security.audit_ip_hash_salt = 'test-salt-32-characters-long!!';

      const result = hashIpAddress(null);

      expect(result).toBeNull();
    });

    it('should return null when IP address is undefined', () => {
      configModule.config.security.audit_ip_hash_salt = 'test-salt-32-characters-long!!';

      const result = hashIpAddress(undefined);

      expect(result).toBeNull();
    });

    it('should return null when IP address is empty string', () => {
      configModule.config.security.audit_ip_hash_salt = 'test-salt-32-characters-long!!';

      const result = hashIpAddress('');

      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle localhost IPv4 address', () => {
      const knownSalt = 'test-salt-32-characters-long!!';
      configModule.config.security.audit_ip_hash_salt = knownSalt;

      const result = hashIpAddress('127.0.0.1');

      expect(result).not.toBeNull();
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should handle localhost IPv6 address', () => {
      const knownSalt = 'test-salt-32-characters-long!!';
      configModule.config.security.audit_ip_hash_salt = knownSalt;

      const result = hashIpAddress('::1');

      expect(result).not.toBeNull();
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should handle IPv6 with mixed notation', () => {
      const knownSalt = 'test-salt-32-characters-long!!';
      configModule.config.security.audit_ip_hash_salt = knownSalt;

      const result = hashIpAddress('::ffff:192.0.2.1');

      expect(result).not.toBeNull();
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
