package handlers

import (
	"strconv"

	"github.com/gofiber/fiber/v2"

	"farseer/database"
	"farseer/middleware"
	"farseer/models"
)

// ListGroups returns all groups for the current user
func ListGroups(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	var groups []models.Group
	if result := database.DB.Where("user_id = ?", userID).Order("name").Find(&groups); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch groups",
		})
	}

	return c.JSON(groups)
}

// CreateGroup creates a new group
func CreateGroup(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	var input models.GroupInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if input.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Name is required",
		})
	}

	// Default color if not provided
	if input.Color == "" {
		input.Color = "#3b82f6"
	}

	group := models.Group{
		UserID: userID,
		Name:   input.Name,
		Color:  input.Color,
	}

	if result := database.DB.Create(&group); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create group",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(group)
}

// UpdateGroup updates an existing group
func UpdateGroup(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	groupID, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid group ID",
		})
	}

	var group models.Group
	if result := database.DB.Where("id = ? AND user_id = ?", groupID, userID).First(&group); result.Error != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Group not found",
		})
	}

	var input models.GroupInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if input.Name != "" {
		group.Name = input.Name
	}
	if input.Color != "" {
		group.Color = input.Color
	}

	if result := database.DB.Save(&group); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to update group",
		})
	}

	return c.JSON(group)
}

// DeleteGroup deletes a group and ungroups its machines
func DeleteGroup(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	groupID, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid group ID",
		})
	}

	var group models.Group
	if result := database.DB.Where("id = ? AND user_id = ?", groupID, userID).First(&group); result.Error != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Group not found",
		})
	}

	// Ungroup all machines in this group (set group_id to NULL)
	database.DB.Model(&models.Machine{}).Where("group_id = ?", groupID).Update("group_id", nil)

	if result := database.DB.Delete(&group); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to delete group",
		})
	}

	return c.SendStatus(fiber.StatusNoContent)
}
