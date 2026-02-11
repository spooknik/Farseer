package services

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"

	"golang.org/x/crypto/pbkdf2"

	"farseer/config"
)

const (
	keyLength  = 32 // AES-256
	saltLength = 16
	iterations = 100000
)

// CredentialData holds the decrypted credential information
type CredentialData struct {
	Password   string `json:"password,omitempty"`
	PrivateKey string `json:"private_key,omitempty"`
	Passphrase string `json:"passphrase,omitempty"`
}

// EncryptedData holds the encrypted data with its salt
type EncryptedData struct {
	Salt       []byte `json:"salt"`
	Nonce      []byte `json:"nonce"`
	Ciphertext []byte `json:"ciphertext"`
}

func deriveKey(password string, salt []byte) []byte {
	cfg := config.GetConfig()
	// Combine user password with server secret for extra security
	combined := password + cfg.ServerSecret
	return pbkdf2.Key([]byte(combined), salt, iterations, keyLength, sha256.New)
}

// EncryptCredential encrypts credential data using AES-256-GCM
func EncryptCredential(data *CredentialData, userPassword string) ([]byte, error) {
	// Marshal credential data to JSON
	plaintext, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}

	// Generate random salt
	salt := make([]byte, saltLength)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, err
	}

	// Derive key
	key := deriveKey(userPassword, salt)

	// Create cipher
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	// Generate nonce
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	// Encrypt
	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)

	// Package everything together
	encData := EncryptedData{
		Salt:       salt,
		Nonce:      nonce,
		Ciphertext: ciphertext,
	}

	return json.Marshal(encData)
}

// DecryptCredential decrypts credential data
func DecryptCredential(encryptedBytes []byte, userPassword string) (*CredentialData, error) {
	// Unmarshal encrypted data
	var encData EncryptedData
	if err := json.Unmarshal(encryptedBytes, &encData); err != nil {
		return nil, err
	}

	// Derive key
	key := deriveKey(userPassword, encData.Salt)

	// Create cipher
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	// Validate nonce size
	if len(encData.Nonce) != gcm.NonceSize() {
		return nil, errors.New("invalid nonce size")
	}

	// Decrypt
	plaintext, err := gcm.Open(nil, encData.Nonce, encData.Ciphertext, nil)
	if err != nil {
		return nil, errors.New("decryption failed - invalid password or corrupted data")
	}

	// Unmarshal credential data
	var data CredentialData
	if err := json.Unmarshal(plaintext, &data); err != nil {
		return nil, err
	}

	return &data, nil
}
