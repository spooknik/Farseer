package models

import (
	"time"

	"gorm.io/gorm"
)

type Role string

const (
	RoleAdmin Role = "admin"
	RoleUser  Role = "user"
)

type User struct {
	ID           uint           `gorm:"primaryKey" json:"id"`
	Username     string         `gorm:"uniqueIndex;not null" json:"username"`
	PasswordHash string         `gorm:"not null" json:"-"`
	Role         Role           `gorm:"not null;default:user" json:"role"`
	TOTPSecret   string         `gorm:"" json:"-"`
	TOTPEnabled  bool           `gorm:"default:false" json:"-"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`
}

// UserResponse is the safe response format for users
type UserResponse struct {
	ID          uint      `json:"id"`
	Username    string    `json:"username"`
	Role        Role      `json:"role"`
	TOTPEnabled bool      `json:"totp_enabled"`
	CreatedAt   time.Time `json:"created_at"`
}

func (u *User) ToResponse() UserResponse {
	return UserResponse{
		ID:          u.ID,
		Username:    u.Username,
		Role:        u.Role,
		TOTPEnabled: u.TOTPEnabled,
		CreatedAt:   u.CreatedAt,
	}
}

// UserInput is used for creating/updating users
type UserInput struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     Role   `json:"role"`
}
