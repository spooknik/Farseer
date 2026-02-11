package handlers

import (
	"farseer/config"
	"farseer/database"
	"farseer/middleware"
	"farseer/models"
	"farseer/services"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type SetupRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type AuthResponse struct {
	Token string       `json:"token"`
	User  models.User  `json:"user"`
}

// CheckSetup returns whether the initial setup has been completed
func CheckSetup(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"setup_complete": database.IsSetupComplete(),
	})
}

// Setup creates the initial admin user
func Setup(c *fiber.Ctx) error {
	// Check if setup already complete
	if database.IsSetupComplete() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Setup already complete",
		})
	}

	var req SetupRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate input
	if len(req.Username) < 3 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Username must be at least 3 characters",
		})
	}
	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Password must be at least 8 characters",
		})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to hash password",
		})
	}

	// Create admin user (first user is always admin)
	user := models.User{
		Username:     req.Username,
		PasswordHash: string(hashedPassword),
		Role:         models.RoleAdmin,
	}

	if result := database.DB.Create(&user); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create user",
		})
	}

	// Generate token
	token, err := generateToken(&user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate token",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(AuthResponse{
		Token: token,
		User:  user,
	})
}

// Login authenticates a user and returns a JWT token
func Login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Find user
	var user models.User
	if result := database.DB.Where("username = ?", req.Username).First(&user); result.Error != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid credentials",
		})
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid credentials",
		})
	}

	// Generate token
	token, err := generateToken(&user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate token",
		})
	}

	// Log successful login
	services.LogAudit(user.ID, user.Username, models.AuditActionLogin, nil, "", "", c.IP())

	return c.JSON(AuthResponse{
		Token: token,
		User:  user,
	})
}

// GetCurrentUser returns the currently authenticated user
func GetCurrentUser(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	var user models.User
	if result := database.DB.First(&user, userID); result.Error != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "User not found",
		})
	}

	return c.JSON(user.ToResponse())
}

// ListUsers returns all users (admin only)
func ListUsers(c *fiber.Ctx) error {
	var users []models.User
	if result := database.DB.Find(&users); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch users",
		})
	}

	responses := make([]models.UserResponse, len(users))
	for i, u := range users {
		responses[i] = u.ToResponse()
	}

	return c.JSON(responses)
}

// CreateUser creates a new user (admin only)
func CreateUser(c *fiber.Ctx) error {
	var input models.UserInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate input
	if len(input.Username) < 3 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Username must be at least 3 characters",
		})
	}
	if len(input.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Password must be at least 8 characters",
		})
	}
	if input.Role != models.RoleAdmin && input.Role != models.RoleUser {
		input.Role = models.RoleUser
	}

	// Check if username exists
	var existing models.User
	if result := database.DB.Where("username = ?", input.Username).First(&existing); result.Error == nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": "Username already exists",
		})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to hash password",
		})
	}

	user := models.User{
		Username:     input.Username,
		PasswordHash: string(hashedPassword),
		Role:         input.Role,
	}

	if result := database.DB.Create(&user); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create user",
		})
	}

	// Log user creation
	currentUserID := middleware.GetUserID(c)
	currentUsername := middleware.GetUsername(c)
	services.LogAudit(currentUserID, currentUsername, models.AuditActionUserCreate, nil, "", "Created user: "+user.Username, c.IP())

	return c.Status(fiber.StatusCreated).JSON(user.ToResponse())
}

// UpdateUser updates a user (admin only)
func UpdateUser(c *fiber.Ctx) error {
	userID, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid user ID",
		})
	}

	var user models.User
	if result := database.DB.First(&user, userID); result.Error != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "User not found",
		})
	}

	var input models.UserInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Update username if provided
	if input.Username != "" && input.Username != user.Username {
		if len(input.Username) < 3 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Username must be at least 3 characters",
			})
		}
		// Check if username exists
		var existing models.User
		if result := database.DB.Where("username = ? AND id != ?", input.Username, userID).First(&existing); result.Error == nil {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "Username already exists",
			})
		}
		user.Username = input.Username
	}

	// Update password if provided
	if input.Password != "" {
		if len(input.Password) < 8 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Password must be at least 8 characters",
			})
		}
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to hash password",
			})
		}
		user.PasswordHash = string(hashedPassword)
	}

	// Update role if provided
	if input.Role == models.RoleAdmin || input.Role == models.RoleUser {
		user.Role = input.Role
	}

	if result := database.DB.Save(&user); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to update user",
		})
	}

	// Log user update
	currentUserID := middleware.GetUserID(c)
	currentUsername := middleware.GetUsername(c)
	services.LogAudit(currentUserID, currentUsername, models.AuditActionUserUpdate, nil, "", "Updated user: "+user.Username, c.IP())

	return c.JSON(user.ToResponse())
}

// DeleteUser deletes a user (admin only)
func DeleteUser(c *fiber.Ctx) error {
	currentUserID := middleware.GetUserID(c)
	userID, err := strconv.ParseUint(c.Params("id"), 10, 32)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid user ID",
		})
	}

	// Prevent self-deletion
	if uint(userID) == currentUserID {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Cannot delete your own account",
		})
	}

	var user models.User
	if result := database.DB.First(&user, userID); result.Error != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "User not found",
		})
	}

	// Delete user's machines first
	database.DB.Where("user_id = ?", userID).Delete(&models.Machine{})

	deletedUsername := user.Username
	if result := database.DB.Delete(&user); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to delete user",
		})
	}

	// Log user deletion
	currentUsername := middleware.GetUsername(c)
	services.LogAudit(currentUserID, currentUsername, models.AuditActionUserDelete, nil, "", "Deleted user: "+deletedUsername, c.IP())

	return c.SendStatus(fiber.StatusNoContent)
}

func generateToken(user *models.User) (string, error) {
	cfg := config.GetConfig()

	claims := middleware.Claims{
		UserID:   user.ID,
		Username: user.Username,
		Role:     string(user.Role),
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(cfg.JWTSecret))
}
