package handlers

import (
	"strconv"

	"github.com/gofiber/fiber/v2"

	"farseer/database"
	"farseer/models"
)

// ListAuditLogs returns audit logs (admin only)
func ListAuditLogs(c *fiber.Ctx) error {
	// Parse query parameters
	page, _ := strconv.Atoi(c.Query("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit", "50"))
	action := c.Query("action")
	userIDStr := c.Query("user_id")
	machineIDStr := c.Query("machine_id")

	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 50
	}
	offset := (page - 1) * limit

	// Build query
	query := database.DB.Model(&models.AuditLog{})

	if action != "" {
		query = query.Where("action = ?", action)
	}
	if userIDStr != "" {
		if userID, err := strconv.ParseUint(userIDStr, 10, 32); err == nil {
			query = query.Where("user_id = ?", userID)
		}
	}
	if machineIDStr != "" {
		if machineID, err := strconv.ParseUint(machineIDStr, 10, 32); err == nil {
			query = query.Where("machine_id = ?", machineID)
		}
	}

	// Get total count
	var total int64
	query.Count(&total)

	// Get logs
	var logs []models.AuditLog
	if result := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&logs); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch audit logs",
		})
	}

	responses := make([]models.AuditLogResponse, len(logs))
	for i, log := range logs {
		responses[i] = log.ToResponse()
	}

	return c.JSON(fiber.Map{
		"logs":  responses,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// GetAuditActions returns available audit actions for filtering
func GetAuditActions(c *fiber.Ctx) error {
	actions := []string{
		string(models.AuditActionLogin),
		string(models.AuditActionLogout),
		string(models.AuditActionSSHConnect),
		string(models.AuditActionSSHDisconnect),
		string(models.AuditActionSFTPList),
		string(models.AuditActionSFTPDownload),
		string(models.AuditActionSFTPUpload),
		string(models.AuditActionSFTPDelete),
		string(models.AuditActionSFTPMkdir),
		string(models.AuditActionSFTPRename),
		string(models.AuditActionMachineCreate),
		string(models.AuditActionMachineUpdate),
		string(models.AuditActionMachineDelete),
		string(models.AuditActionUserCreate),
		string(models.AuditActionUserUpdate),
		string(models.AuditActionUserDelete),
	}

	return c.JSON(actions)
}
