package handlers

import (
	"io"
	"path/filepath"
	"strconv"

	"github.com/gofiber/fiber/v2"

	"farseer/database"
	"farseer/middleware"
	"farseer/models"
	"farseer/services"
)

// sftpClientWithInfo holds client and metadata for audit logging
type sftpClientWithInfo struct {
	client      *services.SFTPClient
	machineID   uint
	machineName string
	userID      uint
	username    string
}

// Helper function to get SFTP client for a machine
func getSFTPClient(c *fiber.Ctx) (*sftpClientWithInfo, error) {
	userID := middleware.GetUserID(c)
	username := middleware.GetUsername(c)
	machineID, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return nil, fiber.NewError(fiber.StatusBadRequest, "Invalid machine ID")
	}

	var machine models.Machine
	if result := database.DB.Where("id = ? AND user_id = ?", machineID, userID).First(&machine); result.Error != nil {
		return nil, fiber.NewError(fiber.StatusNotFound, "Machine not found")
	}

	// Get encryption key
	encryptionKey := c.Get("X-Encryption-Key")
	if encryptionKey == "" {
		encryptionKey = middleware.GetUsername(c)
	}

	// Decrypt credentials
	credData, err := services.DecryptCredential(machine.CredentialEncrypted, encryptionKey)
	if err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError, "Failed to decrypt credentials")
	}

	// Create SFTP client
	sftpClient, err := services.NewSFTPClient(&services.SSHConfig{
		Hostname:   machine.Hostname,
		Port:       machine.Port,
		Username:   machine.Username,
		Password:   credData.Password,
		PrivateKey: credData.PrivateKey,
		Passphrase: credData.Passphrase,
		HostKey:    machine.HostKey,
	})
	if err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError, "Failed to connect: "+err.Error())
	}

	return &sftpClientWithInfo{
		client:      sftpClient,
		machineID:   uint(machineID),
		machineName: machine.Name,
		userID:      userID,
		username:    username,
	}, nil
}

// SFTPListDirectory lists files in a directory
func SFTPListDirectory(c *fiber.Ctx) error {
	info, err := getSFTPClient(c)
	if err != nil {
		return err
	}
	defer info.client.Close()

	path := c.Query("path", "")

	files, err := info.client.ListDirectory(path)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	// Get current working directory for reference
	cwd, _ := info.client.GetWorkingDirectory()

	// Log SFTP list (only log non-empty paths to reduce noise)
	if path != "" {
		services.LogAudit(info.userID, info.username, models.AuditActionSFTPList, &info.machineID, info.machineName, "Listed: "+path, c.IP())
	}

	return c.JSON(fiber.Map{
		"cwd":   cwd,
		"path":  path,
		"files": files,
	})
}

// SFTPDownloadFile downloads a file
func SFTPDownloadFile(c *fiber.Ctx) error {
	info, err := getSFTPClient(c)
	if err != nil {
		return err
	}
	defer info.client.Close()

	path := c.Query("path")
	if path == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Path is required",
		})
	}

	reader, size, err := info.client.DownloadFile(path)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}
	defer reader.Close()

	// Log SFTP download
	services.LogAudit(info.userID, info.username, models.AuditActionSFTPDownload, &info.machineID, info.machineName, "Downloaded: "+path, c.IP())

	// Set headers for file download
	filename := filepath.Base(path)
	c.Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	c.Set("Content-Type", "application/octet-stream")
	c.Set("Content-Length", strconv.FormatInt(size, 10))

	_, err = io.Copy(c.Response().BodyWriter(), reader)
	return err
}

// SFTPUploadFile uploads a file
func SFTPUploadFile(c *fiber.Ctx) error {
	info, err := getSFTPClient(c)
	if err != nil {
		return err
	}
	defer info.client.Close()

	// Get destination path
	destPath := c.Query("path")
	if destPath == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Destination path is required",
		})
	}

	// Get uploaded file
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File is required",
		})
	}

	// Open the file
	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to open uploaded file",
		})
	}
	defer src.Close()

	// If destPath is a directory, append filename
	stat, err := info.client.Stat(destPath)
	if err == nil && stat.IsDir {
		destPath = filepath.Join(destPath, file.Filename)
	}

	// Upload
	if err := info.client.UploadFile(destPath, src, file.Size); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	// Log SFTP upload
	services.LogAudit(info.userID, info.username, models.AuditActionSFTPUpload, &info.machineID, info.machineName, "Uploaded: "+destPath, c.IP())

	return c.JSON(fiber.Map{
		"message": "File uploaded successfully",
		"path":    destPath,
	})
}

// SFTPDelete deletes a file or directory
func SFTPDelete(c *fiber.Ctx) error {
	info, err := getSFTPClient(c)
	if err != nil {
		return err
	}
	defer info.client.Close()

	path := c.Query("path")
	if path == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Path is required",
		})
	}

	if err := info.client.DeleteFile(path); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	// Log SFTP delete
	services.LogAudit(info.userID, info.username, models.AuditActionSFTPDelete, &info.machineID, info.machineName, "Deleted: "+path, c.IP())

	return c.JSON(fiber.Map{
		"message": "Deleted successfully",
	})
}

// SFTPMakeDirectory creates a directory
func SFTPMakeDirectory(c *fiber.Ctx) error {
	info, err := getSFTPClient(c)
	if err != nil {
		return err
	}
	defer info.client.Close()

	var input struct {
		Path string `json:"path"`
	}
	if err := c.BodyParser(&input); err != nil || input.Path == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Path is required",
		})
	}

	if err := info.client.MakeDirectory(input.Path); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	// Log SFTP mkdir
	services.LogAudit(info.userID, info.username, models.AuditActionSFTPMkdir, &info.machineID, info.machineName, "Created directory: "+input.Path, c.IP())

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Directory created",
		"path":    input.Path,
	})
}

// SFTPRename renames/moves a file or directory
func SFTPRename(c *fiber.Ctx) error {
	info, err := getSFTPClient(c)
	if err != nil {
		return err
	}
	defer info.client.Close()

	var input struct {
		OldPath string `json:"old_path"`
		NewPath string `json:"new_path"`
	}
	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if input.OldPath == "" || input.NewPath == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Both old_path and new_path are required",
		})
	}

	if err := info.client.Rename(input.OldPath, input.NewPath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	// Log SFTP rename
	services.LogAudit(info.userID, info.username, models.AuditActionSFTPRename, &info.machineID, info.machineName, "Renamed: "+input.OldPath+" -> "+input.NewPath, c.IP())

	return c.JSON(fiber.Map{
		"message": "Renamed successfully",
	})
}

// SFTPStat returns information about a file
func SFTPStat(c *fiber.Ctx) error {
	info, err := getSFTPClient(c)
	if err != nil {
		return err
	}
	defer info.client.Close()

	path := c.Query("path")
	if path == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Path is required",
		})
	}

	fileInfo, err := info.client.Stat(path)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	return c.JSON(fileInfo)
}
