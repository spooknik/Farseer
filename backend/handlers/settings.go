package handlers

import (
	"farseer/config"

	"github.com/gofiber/fiber/v2"
)

type AppSettings struct {
	SessionDurationHours int `json:"session_duration_hours"`
}

// GetSettings returns non-sensitive application settings (admin only)
func GetSettings(c *fiber.Ctx) error {
	cfg := config.GetConfig()
	return c.JSON(AppSettings{
		SessionDurationHours: cfg.SessionDurationHours,
	})
}

// UpdateSettings updates application settings (admin only)
func UpdateSettings(c *fiber.Ctx) error {
	var input AppSettings
	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if input.SessionDurationHours < 1 || input.SessionDurationHours > 720 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Session duration must be between 1 and 720 hours",
		})
	}

	cfg := config.GetConfig()
	cfg.SessionDurationHours = input.SessionDurationHours

	if err := cfg.Save(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save settings",
		})
	}

	return c.JSON(AppSettings{
		SessionDurationHours: cfg.SessionDurationHours,
	})
}
