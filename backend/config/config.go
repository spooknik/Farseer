package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type Config struct {
	ServerPort           string `json:"server_port"`
	DatabasePath         string `json:"database_path"`
	ServerSecret         string `json:"server_secret"`
	JWTSecret            string `json:"jwt_secret"`
	Production           bool   `json:"production"`
	SessionDurationHours int    `json:"session_duration_hours"`
}

var (
	instance *Config
	once     sync.Once
)

func generateSecret(length int) string {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		panic(err)
	}
	return hex.EncodeToString(bytes)
}

func getConfigPath() string {
	configDir := os.Getenv("FARSEER_CONFIG_DIR")
	if configDir == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			configDir = "."
		} else {
			configDir = filepath.Join(homeDir, ".farseer")
		}
	}
	return filepath.Join(configDir, "config.json")
}

func GetConfig() *Config {
	once.Do(func() {
		instance = &Config{
			ServerPort:   "8080",
			DatabasePath: "",
			ServerSecret: "",
			JWTSecret:    "",
			Production:   false,
		}

		configPath := getConfigPath()

		// Try to load existing config
		if data, err := os.ReadFile(configPath); err == nil {
			if err := json.Unmarshal(data, instance); err != nil {
				// Config file is corrupted, will use defaults
			}
		}

		// Set defaults
		if instance.SessionDurationHours == 0 {
			instance.SessionDurationHours = 24
		}

		// Generate secrets if not set
		needsSave := false
		if instance.ServerSecret == "" {
			instance.ServerSecret = generateSecret(32)
			needsSave = true
		}
		if instance.JWTSecret == "" {
			instance.JWTSecret = generateSecret(32)
			needsSave = true
		}
		if instance.DatabasePath == "" {
			configDir := filepath.Dir(configPath)
			instance.DatabasePath = filepath.Join(configDir, "farseer.db")
			needsSave = true
		}

		// Override with environment variables
		if port := os.Getenv("FARSEER_PORT"); port != "" {
			instance.ServerPort = port
		}
		if dbPath := os.Getenv("FARSEER_DB_PATH"); dbPath != "" {
			instance.DatabasePath = dbPath
		}
		if os.Getenv("FARSEER_PRODUCTION") == "true" {
			instance.Production = true
		}

		// Save config if we generated new secrets
		if needsSave {
			instance.Save()
		}
	})

	return instance
}

func (c *Config) Save() error {
	configPath := getConfigPath()

	// Create config directory if it doesn't exist
	configDir := filepath.Dir(configPath)
	if err := os.MkdirAll(configDir, 0700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(configPath, data, 0600)
}
