package models

import (
	"time"

	"gorm.io/gorm"
)

type AuthType string

const (
	AuthTypePassword AuthType = "password"
	AuthTypeKey      AuthType = "key"
)

type Machine struct {
	ID                  uint           `gorm:"primaryKey" json:"id"`
	UserID              uint           `gorm:"not null;index" json:"user_id"`
	GroupID             *uint          `gorm:"index" json:"group_id"`
	Name                string         `gorm:"not null" json:"name"`
	Hostname            string         `gorm:"not null" json:"hostname"`
	Port                int            `gorm:"default:22" json:"port"`
	Username            string         `gorm:"not null" json:"username"`
	AuthType            AuthType       `gorm:"not null" json:"auth_type"`
	CredentialEncrypted []byte         `gorm:"type:blob" json:"-"`
	HostKey             string         `json:"host_key,omitempty"`
	CreatedAt           time.Time      `json:"created_at"`
	UpdatedAt           time.Time      `json:"updated_at"`
	DeletedAt           gorm.DeletedAt `gorm:"index" json:"-"`
}

// MachineInput is used for creating/updating machines
type MachineInput struct {
	Name       string   `json:"name" validate:"required"`
	GroupID    *uint    `json:"group_id"`
	Hostname   string   `json:"hostname" validate:"required"`
	Port       int      `json:"port"`
	Username   string   `json:"username" validate:"required"`
	AuthType   AuthType `json:"auth_type" validate:"required,oneof=password key"`
	Credential string   `json:"credential"` // Password or private key (will be encrypted)
	Passphrase string   `json:"passphrase,omitempty"` // For encrypted private keys
}

// MachineResponse is the safe response without sensitive data
type MachineResponse struct {
	ID        uint      `json:"id"`
	GroupID   *uint     `json:"group_id"`
	Name      string    `json:"name"`
	Hostname  string    `json:"hostname"`
	Port      int       `json:"port"`
	Username  string    `json:"username"`
	AuthType  AuthType  `json:"auth_type"`
	HostKey   string    `json:"host_key,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (m *Machine) ToResponse() MachineResponse {
	return MachineResponse{
		ID:        m.ID,
		GroupID:   m.GroupID,
		Name:      m.Name,
		Hostname:  m.Hostname,
		Port:      m.Port,
		Username:  m.Username,
		AuthType:  m.AuthType,
		HostKey:   m.HostKey,
		CreatedAt: m.CreatedAt,
		UpdatedAt: m.UpdatedAt,
	}
}
