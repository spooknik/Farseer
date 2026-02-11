package services

import (
	"farseer/database"
	"farseer/models"
)

// LogAudit creates an audit log entry
func LogAudit(userID uint, username string, action models.AuditAction, machineID *uint, machineName string, details string, ipAddress string) {
	log := models.AuditLog{
		UserID:      userID,
		Username:    username,
		Action:      action,
		MachineID:   machineID,
		MachineName: machineName,
		Details:     details,
		IPAddress:   ipAddress,
	}

	// Fire and forget - don't block on audit logging
	go func() {
		database.DB.Create(&log)
	}()
}

// LogAuditSync creates an audit log entry synchronously
func LogAuditSync(userID uint, username string, action models.AuditAction, machineID *uint, machineName string, details string, ipAddress string) error {
	log := models.AuditLog{
		UserID:      userID,
		Username:    username,
		Action:      action,
		MachineID:   machineID,
		MachineName: machineName,
		Details:     details,
		IPAddress:   ipAddress,
	}

	return database.DB.Create(&log).Error
}
