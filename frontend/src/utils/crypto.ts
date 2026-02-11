/**
 * Derives an encryption key from a password using PBKDF2
 * This key is used to encrypt/decrypt SSH credentials client-side before sending to server
 */

const ITERATIONS = 100000;
const KEY_LENGTH = 256;
const SALT_PREFIX = 'farseer-credential-key-';

/**
 * Derives a key from password using PBKDF2 with SHA-256
 * The salt is derived from the username to ensure consistent key derivation
 */
export async function deriveEncryptionKey(username: string, password: string): Promise<string> {
  const encoder = new TextEncoder();

  // Use username as salt basis (combined with a prefix for uniqueness)
  const salt = encoder.encode(SALT_PREFIX + username);

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  // Derive bits using PBKDF2
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH
  );

  // Convert to hex string for easy storage and transmission
  const hashArray = Array.from(new Uint8Array(derivedBits));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}
