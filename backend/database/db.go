package database

import (
	"farseer/config"
	"farseer/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func Connect() error {
	cfg := config.GetConfig()

	var err error
	DB, err = gorm.Open(sqlite.Open(cfg.DatabasePath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return err
	}

	// Auto-migrate models
	err = DB.AutoMigrate(&models.User{}, &models.Machine{}, &models.Group{}, &models.AuditLog{})
	if err != nil {
		return err
	}

	return nil
}

func IsSetupComplete() bool {
	var count int64
	DB.Model(&models.User{}).Count(&count)
	return count > 0
}
