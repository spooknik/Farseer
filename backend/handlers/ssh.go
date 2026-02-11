package handlers

import (
	"encoding/json"
	"io"
	"log"
	"strconv"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"

	"farseer/config"
	"farseer/database"
	"farseer/middleware"
	"farseer/models"
	"farseer/services"
)

// WebSocket message types
type WSMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type ResizeData struct {
	Rows int `json:"rows"`
	Cols int `json:"cols"`
}

type InputData struct {
	Data string `json:"data"`
}

type OutputData struct {
	Data string `json:"data"`
}

type ErrorData struct {
	Error string `json:"error"`
}

type ConnectedData struct {
	HostKey string `json:"host_key"`
}

type AuthData struct {
	Key string `json:"key"`
}

type HostKeyData struct {
	Status       string `json:"status"` // "new", "match", "mismatch"
	Fingerprint  string `json:"fingerprint"`
	StoredKey    string `json:"stored_key,omitempty"`
}

type HostKeyConfirmData struct {
	Accept bool `json:"accept"`
}

// Active sessions map
var (
	activeSessions = make(map[string]*services.SSHSession)
	sessionsMu     sync.RWMutex
)

// SSHWebSocketUpgrade is middleware to upgrade HTTP to WebSocket
func SSHWebSocketUpgrade(c *fiber.Ctx) error {
	if websocket.IsWebSocketUpgrade(c) {
		// Validate JWT token from query parameter
		tokenString := c.Query("token")
		if tokenString == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Token required",
			})
		}

		cfg := config.GetConfig()
		token, err := jwt.ParseWithClaims(tokenString, &middleware.Claims{}, func(token *jwt.Token) (interface{}, error) {
			return []byte(cfg.JWTSecret), nil
		})

		if err != nil || !token.Valid {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Invalid token",
			})
		}

		claims, ok := token.Claims.(*middleware.Claims)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Invalid token claims",
			})
		}

		// Store user info in locals for WebSocket handler
		c.Locals("userID", claims.UserID)
		c.Locals("username", claims.Username)

		return c.Next()
	}
	return fiber.ErrUpgradeRequired
}

// SSHWebSocket handles the WebSocket connection for SSH
func SSHWebSocket(c *websocket.Conn) {
	// Get machine ID from params
	machineIDStr := c.Params("id")
	machineID, err := strconv.ParseUint(machineIDStr, 10, 32)
	if err != nil {
		sendWSError(c, "Invalid machine ID")
		return
	}

	// Get user ID from query (validated in upgrade middleware)
	userIDStr := c.Query("user_id")
	userID, err := strconv.ParseUint(userIDStr, 10, 32)
	if err != nil {
		sendWSError(c, "Invalid user ID")
		return
	}

	log.Printf("SSH WebSocket connection: machine=%d, user=%d", machineID, userID)

	// Send ready message to signal client to send encryption key
	sendWSMessage(c, "ready", nil)

	// Wait for auth message with encryption key (with timeout)
	c.SetReadDeadline(time.Now().Add(30 * time.Second))
	_, msg, err := c.ReadMessage()
	if err != nil {
		sendWSError(c, "Timeout waiting for authentication")
		return
	}
	c.SetReadDeadline(time.Time{}) // Clear deadline

	var authMsg WSMessage
	if err := json.Unmarshal(msg, &authMsg); err != nil || authMsg.Type != "auth" {
		sendWSError(c, "Expected auth message")
		return
	}

	var authData AuthData
	if err := json.Unmarshal(authMsg.Data, &authData); err != nil || authData.Key == "" {
		sendWSError(c, "Invalid auth data")
		return
	}

	encryptionKey := authData.Key

	// Fetch machine from database
	var machine models.Machine
	if result := database.DB.Where("id = ? AND user_id = ?", machineID, userID).First(&machine); result.Error != nil {
		sendWSError(c, "Machine not found")
		return
	}

	// Decrypt credentials
	credData, err := services.DecryptCredential(machine.CredentialEncrypted, encryptionKey)
	if err != nil {
		sendWSError(c, "Failed to decrypt credentials: "+err.Error())
		return
	}

	// Prepare SSH config - first attempt with host key check to see what we get
	sshConfig := &services.SSHConfig{
		Hostname:         machine.Hostname,
		Port:             machine.Port,
		Username:         machine.Username,
		Password:         credData.Password,
		PrivateKey:       credData.PrivateKey,
		Passphrase:       credData.Passphrase,
		HostKey:          machine.HostKey,
		SkipHostKeyCheck: true, // Skip check initially to get the key info
	}

	// Connect to SSH server
	session, hostKeyResult, err := services.ConnectSSH(sshConfig)
	if err != nil {
		sendWSError(c, "SSH connection failed: "+err.Error())
		return
	}

	// If this is a new key or mismatched key, ask user for confirmation
	if hostKeyResult.Status == "new" || hostKeyResult.Status == "mismatch" {
		// Send host key info to client for confirmation
		sendWSMessage(c, "host_key_verify", HostKeyData{
			Status:      hostKeyResult.Status,
			Fingerprint: hostKeyResult.Fingerprint,
			StoredKey:   machine.HostKey,
		})

		// Wait for confirmation
		c.SetReadDeadline(time.Now().Add(60 * time.Second)) // Give user time to decide
		_, confirmMsg, err := c.ReadMessage()
		if err != nil {
			session.Close()
			sendWSError(c, "Timeout waiting for host key confirmation")
			return
		}
		c.SetReadDeadline(time.Time{})

		var confirmWsMsg WSMessage
		if err := json.Unmarshal(confirmMsg, &confirmWsMsg); err != nil || confirmWsMsg.Type != "host_key_confirm" {
			session.Close()
			sendWSError(c, "Expected host key confirmation")
			return
		}

		var confirmData HostKeyConfirmData
		if err := json.Unmarshal(confirmWsMsg.Data, &confirmData); err != nil {
			session.Close()
			sendWSError(c, "Invalid confirmation data")
			return
		}

		if !confirmData.Accept {
			session.Close()
			sendWSError(c, "Host key rejected by user")
			return
		}

		// User accepted - update stored host key
		database.DB.Model(&machine).Update("host_key", hostKeyResult.Fingerprint)
	}

	defer session.Close()

	// Start shell with default size (will be resized by client)
	if err := session.StartShell(24, 80); err != nil {
		sendWSError(c, "Failed to start shell: "+err.Error())
		return
	}

	// Send connected message with host key
	sendWSMessage(c, "connected", ConnectedData{HostKey: hostKeyResult.Fingerprint})

	// Log SSH connection
	machineIDUint := uint(machineID)
	userIDUint := uint(userID)
	services.LogAudit(userIDUint, "", models.AuditActionSSHConnect, &machineIDUint, machine.Name, "Connected to "+machine.Hostname, "")

	// Store session
	sessionKey := machineIDStr + "-" + userIDStr
	sessionsMu.Lock()
	activeSessions[sessionKey] = session
	sessionsMu.Unlock()
	defer func() {
		sessionsMu.Lock()
		delete(activeSessions, sessionKey)
		sessionsMu.Unlock()
		// Log SSH disconnection
		services.LogAudit(userIDUint, "", models.AuditActionSSHDisconnect, &machineIDUint, machine.Name, "Disconnected from "+machine.Hostname, "")
	}()

	// Create done channel
	done := make(chan struct{})
	defer close(done)

	// Read from SSH stdout and send to WebSocket
	go func() {
		buf := make([]byte, 4096)
		for {
			select {
			case <-done:
				return
			default:
				n, err := session.Stdout.Read(buf)
				if err != nil {
					if err != io.EOF {
						log.Printf("SSH read error: %v", err)
					}
					return
				}
				if n > 0 {
					sendWSMessage(c, "output", OutputData{Data: string(buf[:n])})
				}
			}
		}
	}()

	// Read from SSH stderr and send to WebSocket
	go func() {
		buf := make([]byte, 4096)
		for {
			select {
			case <-done:
				return
			default:
				n, err := session.Stderr.Read(buf)
				if err != nil {
					if err != io.EOF {
						log.Printf("SSH stderr read error: %v", err)
					}
					return
				}
				if n > 0 {
					sendWSMessage(c, "output", OutputData{Data: string(buf[:n])})
				}
			}
		}
	}()

	// Read from WebSocket and send to SSH
	for {
		_, msg, err := c.ReadMessage()
		if err != nil {
			log.Printf("WebSocket read error: %v", err)
			break
		}

		var wsMsg WSMessage
		if err := json.Unmarshal(msg, &wsMsg); err != nil {
			log.Printf("Failed to parse WebSocket message: %v", err)
			continue
		}

		switch wsMsg.Type {
		case "input":
			var input InputData
			if err := json.Unmarshal(wsMsg.Data, &input); err != nil {
				log.Printf("Failed to parse input data: %v", err)
				continue
			}
			if _, err := session.Write([]byte(input.Data)); err != nil {
				log.Printf("SSH write error: %v", err)
				return
			}

		case "resize":
			var resize ResizeData
			if err := json.Unmarshal(wsMsg.Data, &resize); err != nil {
				log.Printf("Failed to parse resize data: %v", err)
				continue
			}
			if err := session.Resize(resize.Rows, resize.Cols); err != nil {
				log.Printf("SSH resize error: %v", err)
			}

		case "ping":
			sendWSMessage(c, "pong", nil)
		}
	}
}

func sendWSMessage(c *websocket.Conn, msgType string, data interface{}) {
	dataBytes, _ := json.Marshal(data)
	msg := WSMessage{
		Type: msgType,
		Data: dataBytes,
	}
	msgBytes, _ := json.Marshal(msg)
	c.WriteMessage(websocket.TextMessage, msgBytes)
}

func sendWSError(c *websocket.Conn, errMsg string) {
	sendWSMessage(c, "error", ErrorData{Error: errMsg})
	time.Sleep(100 * time.Millisecond)
	c.Close()
}

// GetHostKey returns the stored host key for a machine
func GetHostKey(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	machineID, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid machine ID",
		})
	}

	var machine models.Machine
	if result := database.DB.Where("id = ? AND user_id = ?", machineID, userID).First(&machine); result.Error != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Machine not found",
		})
	}

	return c.JSON(fiber.Map{
		"host_key": machine.HostKey,
	})
}

// UpdateHostKey allows updating/resetting the host key
func UpdateHostKey(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	machineID, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid machine ID",
		})
	}

	var machine models.Machine
	if result := database.DB.Where("id = ? AND user_id = ?", machineID, userID).First(&machine); result.Error != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Machine not found",
		})
	}

	var input struct {
		HostKey string `json:"host_key"`
	}
	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if result := database.DB.Model(&machine).Update("host_key", input.HostKey); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to update host key",
		})
	}

	return c.JSON(fiber.Map{
		"host_key": input.HostKey,
	})
}
