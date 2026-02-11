package models

import (
	"time"
)

type AuditAction string

const (
	AuditActionLogin         AuditAction = "login"
	AuditActionLogout        AuditAction = "logout"
	AuditActionSSHConnect    AuditAction = "ssh_connect"
	AuditActionSSHDisconnect AuditAction = "ssh_disconnect"
	AuditActionSFTPList      AuditAction = "sftp_list"
	AuditActionSFTPDownload  AuditAction = "sftp_download"
	AuditActionSFTPUpload    AuditAction = "sftp_upload"
	AuditActionSFTPDelete    AuditAction = "sftp_delete"
	AuditActionSFTPMkdir     AuditAction = "sftp_mkdir"
	AuditActionSFTPRename    AuditAction = "sftp_rename"
	AuditActionMachineCreate AuditAction = "machine_create"
	AuditActionMachineUpdate AuditAction = "machine_update"
	AuditActionMachineDelete AuditAction = "machine_delete"
	AuditActionUserCreate    AuditAction = "user_create"
	AuditActionUserUpdate    AuditAction = "user_update"
	AuditActionUserDelete    AuditAction = "user_delete"
)

type AuditLog struct {
	ID          uint        `gorm:"primaryKey" json:"id"`
	UserID      uint        `gorm:"index" json:"user_id"`
	Username    string      `json:"username"`
	Action      AuditAction `gorm:"index" json:"action"`
	MachineID   *uint       `gorm:"index" json:"machine_id,omitempty"`
	MachineName string      `json:"machine_name,omitempty"`
	Details     string      `json:"details,omitempty"`
	IPAddress   string      `json:"ip_address"`
	CreatedAt   time.Time   `gorm:"index" json:"created_at"`
}

// AuditLogResponse is the response format for audit logs
type AuditLogResponse struct {
	ID          uint        `json:"id"`
	UserID      uint        `json:"user_id"`
	Username    string      `json:"username"`
	Action      AuditAction `json:"action"`
	MachineID   *uint       `json:"machine_id,omitempty"`
	MachineName string      `json:"machine_name,omitempty"`
	Details     string      `json:"details,omitempty"`
	IPAddress   string      `json:"ip_address"`
	CreatedAt   time.Time   `json:"created_at"`
}

func (a *AuditLog) ToResponse() AuditLogResponse {
	return AuditLogResponse{
		ID:          a.ID,
		UserID:      a.UserID,
		Username:    a.Username,
		Action:      a.Action,
		MachineID:   a.MachineID,
		MachineName: a.MachineName,
		Details:     a.Details,
		IPAddress:   a.IPAddress,
		CreatedAt:   a.CreatedAt,
	}
}
