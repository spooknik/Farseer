package handlers

import (
	"net"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"farseer/database"
	"farseer/middleware"
	"farseer/models"
	"farseer/services"
)

// hostnameRegex validates hostnames according to RFC 1123
var hostnameRegex = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$`)

// validateHostname checks if the hostname is a valid hostname or IP address
func validateHostname(hostname string) bool {
	hostname = strings.TrimSpace(hostname)
	if hostname == "" {
		return false
	}

	// Check if it's a valid IP address
	if ip := net.ParseIP(hostname); ip != nil {
		return true
	}

	// Check if it's a valid hostname (max 253 characters)
	if len(hostname) > 253 {
		return false
	}

	return hostnameRegex.MatchString(hostname)
}

// validatePort checks if the port is in valid range
func validatePort(port int) bool {
	return port >= 1 && port <= 65535
}

// ListMachines returns all machines for the current user
func ListMachines(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	var machines []models.Machine
	if result := database.DB.Where("user_id = ?", userID).Find(&machines); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch machines",
		})
	}

	// Convert to safe response format
	responses := make([]models.MachineResponse, len(machines))
	for i, m := range machines {
		responses[i] = m.ToResponse()
	}

	return c.JSON(responses)
}

// GetMachine returns a single machine by ID
func GetMachine(c *fiber.Ctx) error {
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

	return c.JSON(machine.ToResponse())
}

// CreateMachine creates a new machine
func CreateMachine(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	var input models.MachineInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate required fields
	if input.Name == "" || input.Hostname == "" || input.Username == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Name, hostname, and username are required",
		})
	}

	// Validate hostname format
	if !validateHostname(input.Hostname) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid hostname format. Must be a valid hostname or IP address",
		})
	}

	// Validate port if provided
	if input.Port != 0 && !validatePort(input.Port) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Port must be between 1 and 65535",
		})
	}

	if input.AuthType != models.AuthTypePassword && input.AuthType != models.AuthTypeKey {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Auth type must be 'password' or 'key'",
		})
	}

	if input.Credential == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Credential (password or private key) is required",
		})
	}

	// Set default port
	port := input.Port
	if port == 0 {
		port = 22
	}

	// Get user's password from token (we need to store encrypted password hash for this)
	// For now, we'll use a session-based encryption key stored in memory
	// In production, you might want to use a different approach
	encryptionKey := c.Get("X-Encryption-Key")
	if encryptionKey == "" {
		// Fallback: use a derived key from the JWT (less secure but functional)
		encryptionKey = middleware.GetUsername(c)
	}

	// Encrypt the credential
	credData := &services.CredentialData{}
	if input.AuthType == models.AuthTypePassword {
		credData.Password = input.Credential
	} else {
		credData.PrivateKey = input.Credential
		credData.Passphrase = input.Passphrase
	}

	encryptedCred, err := services.EncryptCredential(credData, encryptionKey)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to encrypt credentials",
		})
	}

	machine := models.Machine{
		UserID:              userID,
		GroupID:             input.GroupID,
		Name:                input.Name,
		Hostname:            input.Hostname,
		Port:                port,
		Username:            input.Username,
		AuthType:            input.AuthType,
		CredentialEncrypted: encryptedCred,
	}

	if result := database.DB.Create(&machine); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create machine",
		})
	}

	// Log machine creation
	username := middleware.GetUsername(c)
	services.LogAudit(userID, username, models.AuditActionMachineCreate, &machine.ID, machine.Name, "Created machine: "+machine.Name+" ("+machine.Hostname+")", c.IP())

	return c.Status(fiber.StatusCreated).JSON(machine.ToResponse())
}

// UpdateMachine updates an existing machine
func UpdateMachine(c *fiber.Ctx) error {
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

	var input models.MachineInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Update fields if provided
	if input.Name != "" {
		machine.Name = input.Name
	}
	// Update group (can be set to nil to ungroup)
	machine.GroupID = input.GroupID
	if input.Hostname != "" {
		if !validateHostname(input.Hostname) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid hostname format. Must be a valid hostname or IP address",
			})
		}
		machine.Hostname = input.Hostname
	}
	if input.Port != 0 {
		if !validatePort(input.Port) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Port must be between 1 and 65535",
			})
		}
		machine.Port = input.Port
	}
	if input.Username != "" {
		machine.Username = input.Username
	}
	if input.AuthType != "" {
		machine.AuthType = input.AuthType
	}

	// Update credential if provided
	if input.Credential != "" {
		encryptionKey := c.Get("X-Encryption-Key")
		if encryptionKey == "" {
			encryptionKey = middleware.GetUsername(c)
		}

		credData := &services.CredentialData{}
		if input.AuthType == models.AuthTypePassword {
			credData.Password = input.Credential
		} else {
			credData.PrivateKey = input.Credential
			credData.Passphrase = input.Passphrase
		}

		encryptedCred, err := services.EncryptCredential(credData, encryptionKey)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to encrypt credentials",
			})
		}
		machine.CredentialEncrypted = encryptedCred
	}

	if result := database.DB.Save(&machine); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to update machine",
		})
	}

	// Log machine update
	username := middleware.GetUsername(c)
	services.LogAudit(userID, username, models.AuditActionMachineUpdate, &machine.ID, machine.Name, "Updated machine: "+machine.Name, c.IP())

	return c.JSON(machine.ToResponse())
}

// DeleteMachine deletes a machine
func DeleteMachine(c *fiber.Ctx) error {
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

	deletedName := machine.Name
	deletedID := machine.ID
	if result := database.DB.Delete(&machine); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to delete machine",
		})
	}

	// Log machine deletion
	username := middleware.GetUsername(c)
	services.LogAudit(userID, username, models.AuditActionMachineDelete, &deletedID, deletedName, "Deleted machine: "+deletedName, c.IP())

	return c.SendStatus(fiber.StatusNoContent)
}
