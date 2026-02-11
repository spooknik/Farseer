package models

import (
	"time"

	"gorm.io/gorm"
)

type Group struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	UserID    uint           `gorm:"not null;index" json:"user_id"`
	Name      string         `gorm:"not null" json:"name"`
	Color     string         `gorm:"default:#3b82f6" json:"color"` // Hex color for UI
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

type GroupInput struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}
