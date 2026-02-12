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
	"github.com/pquerna/otp/totp"
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
	Token string              `json:"token"`
	User  models.UserResponse `json:"user"`
}

type LoginStepResponse struct {
	// Full auth (returned after TOTP verification)
	Token *string              `json:"token,omitempty"`
	User  *models.UserResponse `json:"user,omitempty"`
	// Partial auth (needs TOTP)
	RequiresTOTP      bool   `json:"requires_totp,omitempty"`
	RequiresTOTPSetup bool   `json:"requires_totp_setup,omitempty"`
	TempToken         string `json:"temp_token,omitempty"`
	TOTPSecret        string `json:"totp_secret,omitempty"`
	TOTPQRURL         string `json:"totp_qr_url,omitempty"`
}

type TOTPVerifyRequest struct {
	Code string `json:"code"`
}

// CheckSetup returns whether the initial setup has been completed
func CheckSetup(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"setup_complete": database.IsSetupComplete(),
	})
}

// Setup creates the initial admin user and begins TOTP enrollment
func Setup(c *fiber.Ctx) error {
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

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to hash password",
		})
	}

	// Generate TOTP secret
	totpKey, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "Farseer",
		AccountName: req.Username,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate TOTP secret",
		})
	}

	// Encrypt TOTP secret for storage
	cfg := config.GetConfig()
	encryptedSecret, err := services.EncryptTOTPSecret(totpKey.Secret(), cfg.ServerSecret)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to encrypt TOTP secret",
		})
	}

	user := models.User{
		Username:     req.Username,
		PasswordHash: string(hashedPassword),
		Role:         models.RoleAdmin,
		TOTPSecret:   encryptedSecret,
		TOTPEnabled:  false,
	}

	if result := database.DB.Create(&user); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create user",
		})
	}

	// Generate temp token for TOTP enrollment
	tempToken, err := generateToken(&user, true)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate token",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(LoginStepResponse{
		RequiresTOTPSetup: true,
		TempToken:         tempToken,
		TOTPSecret:        totpKey.Secret(),
		TOTPQRURL:         totpKey.URL(),
	})
}

// Login authenticates a user and returns either a temp token (needs TOTP) or begins TOTP setup
func Login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	var user models.User
	if result := database.DB.Where("username = ?", req.Username).First(&user); result.Error != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid credentials",
		})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid credentials",
		})
	}

	// Generate temp token
	tempToken, err := generateToken(&user, true)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate token",
		})
	}

	if user.TOTPEnabled {
		// User has TOTP set up — needs to verify code
		return c.JSON(LoginStepResponse{
			RequiresTOTP: true,
			TempToken:    tempToken,
		})
	}

	// User doesn't have TOTP set up yet (admin-created user, first login)
	// Generate a new TOTP secret for enrollment
	totpKey, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "Farseer",
		AccountName: user.Username,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate TOTP secret",
		})
	}

	cfg := config.GetConfig()
	encryptedSecret, err := services.EncryptTOTPSecret(totpKey.Secret(), cfg.ServerSecret)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to encrypt TOTP secret",
		})
	}

	// Store the secret (but keep TOTPEnabled false until verified)
	database.DB.Model(&user).Update("totp_secret", encryptedSecret)

	return c.JSON(LoginStepResponse{
		RequiresTOTPSetup: true,
		TempToken:         tempToken,
		TOTPSecret:        totpKey.Secret(),
		TOTPQRURL:         totpKey.URL(),
	})
}

// LoginTOTP verifies a TOTP code and returns a full JWT
func LoginTOTP(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	var req TOTPVerifyRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.Code == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "TOTP code is required",
		})
	}

	var user models.User
	if result := database.DB.First(&user, userID); result.Error != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "User not found",
		})
	}

	// Decrypt TOTP secret
	cfg := config.GetConfig()
	secret, err := services.DecryptTOTPSecret(user.TOTPSecret, cfg.ServerSecret)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to decrypt TOTP secret",
		})
	}

	// Validate TOTP code
	if !totp.Validate(req.Code, secret) {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid TOTP code",
		})
	}

	// If this is first-time enrollment, mark TOTP as enabled
	if !user.TOTPEnabled {
		database.DB.Model(&user).Update("totp_enabled", true)
		user.TOTPEnabled = true
		services.LogAudit(user.ID, user.Username, models.AuditActionTOTPSetup, nil, "", "TOTP enrolled", c.IP())
	}

	// Generate full JWT
	token, err := generateToken(&user, false)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate token",
		})
	}

	services.LogAudit(user.ID, user.Username, models.AuditActionLogin, nil, "", "", c.IP())

	resp := user.ToResponse()
	return c.JSON(LoginStepResponse{
		Token: &token,
		User:  &resp,
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

	var existing models.User
	if result := database.DB.Where("username = ?", input.Username).First(&existing); result.Error == nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": "Username already exists",
		})
	}

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
		TOTPEnabled:  false, // User will enroll on first login
	}

	if result := database.DB.Create(&user); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create user",
		})
	}

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

	if input.Username != "" && input.Username != user.Username {
		if len(input.Username) < 3 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Username must be at least 3 characters",
			})
		}
		var existing models.User
		if result := database.DB.Where("username = ? AND id != ?", input.Username, userID).First(&existing); result.Error == nil {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "Username already exists",
			})
		}
		user.Username = input.Username
	}

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

	if input.Role == models.RoleAdmin || input.Role == models.RoleUser {
		user.Role = input.Role
	}

	if result := database.DB.Save(&user); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to update user",
		})
	}

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

	database.DB.Where("user_id = ?", userID).Delete(&models.Machine{})

	deletedUsername := user.Username
	if result := database.DB.Delete(&user); result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to delete user",
		})
	}

	currentUsername := middleware.GetUsername(c)
	services.LogAudit(currentUserID, currentUsername, models.AuditActionUserDelete, nil, "", "Deleted user: "+deletedUsername, c.IP())

	return c.SendStatus(fiber.StatusNoContent)
}

func generateToken(user *models.User, temp bool) (string, error) {
	cfg := config.GetConfig()

	var expiry time.Duration
	if temp {
		expiry = 5 * time.Minute
	} else {
		expiry = time.Duration(cfg.SessionDurationHours) * time.Hour
	}

	claims := middleware.Claims{
		UserID:   user.ID,
		Username: user.Username,
		Role:     string(user.Role),
		TempAuth: temp,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(cfg.JWTSecret))
}
