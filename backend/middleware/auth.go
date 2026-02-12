package middleware

import (
	"farseer/config"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID   uint   `json:"user_id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	TempAuth bool   `json:"temp_auth,omitempty"`
	jwt.RegisteredClaims
}

// parseClaims extracts and validates JWT claims from the Authorization header
func parseClaims(c *fiber.Ctx) (*Claims, error) {
	cfg := config.GetConfig()

	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "Missing authorization header")
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid authorization header format")
	}

	token, err := jwt.ParseWithClaims(parts[1], &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(cfg.JWTSecret), nil
	})

	if err != nil || !token.Valid {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid or expired token")
	}

	claims, ok := token.Claims.(*Claims)
	if !ok {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid token claims")
	}

	return claims, nil
}

// AuthRequired validates a full (non-temp) JWT token
func AuthRequired() fiber.Handler {
	return func(c *fiber.Ctx) error {
		claims, err := parseClaims(c)
		if err != nil {
			e := err.(*fiber.Error)
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}

		// Reject temp auth tokens — they can only be used for TOTP verification
		if claims.TempAuth {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "TOTP verification required",
			})
		}

		c.Locals("userID", claims.UserID)
		c.Locals("username", claims.Username)
		c.Locals("role", claims.Role)

		return c.Next()
	}
}

// TempAuthRequired validates a temp JWT token (used only for TOTP verification)
func TempAuthRequired() fiber.Handler {
	return func(c *fiber.Ctx) error {
		claims, err := parseClaims(c)
		if err != nil {
			e := err.(*fiber.Error)
			return c.Status(e.Code).JSON(fiber.Map{"error": e.Message})
		}

		if !claims.TempAuth {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Temporary token required",
			})
		}

		c.Locals("userID", claims.UserID)
		c.Locals("username", claims.Username)
		c.Locals("role", claims.Role)

		return c.Next()
	}
}

// AdminRequired middleware checks if user has admin role
func AdminRequired() fiber.Handler {
	return func(c *fiber.Ctx) error {
		role := GetRole(c)
		if role != "admin" {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "Admin access required",
			})
		}
		return c.Next()
	}
}

func GetUserID(c *fiber.Ctx) uint {
	if userID, ok := c.Locals("userID").(uint); ok {
		return userID
	}
	return 0
}

func GetUsername(c *fiber.Ctx) string {
	if username, ok := c.Locals("username").(string); ok {
		return username
	}
	return ""
}

func GetRole(c *fiber.Ctx) string {
	if role, ok := c.Locals("role").(string); ok {
		return role
	}
	return ""
}

func IsAdmin(c *fiber.Ctx) bool {
	return GetRole(c) == "admin"
}
