package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/contrib/websocket"

	"farseer/config"
	"farseer/database"
	"farseer/handlers"
	"farseer/middleware"
)

func main() {
	// Load configuration
	cfg := config.GetConfig()

	// Connect to database
	if err := database.Connect(); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	// Create Fiber app
	app := fiber.New(fiber.Config{
		AppName:      "Farseer",
		ErrorHandler: customErrorHandler,
	})

	// Middleware
	app.Use(recover.New())
	app.Use(logger.New(logger.Config{
		Format: "${time} ${status} ${method} ${path} ${latency}\n",
	}))
	app.Use(cors.New(cors.Config{
		AllowOrigins:     "http://localhost:5173,http://localhost:3000,http://localhost:8080",
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization, X-Encryption-Key",
		AllowMethods:     "GET, POST, PUT, DELETE, OPTIONS",
		AllowCredentials: true,
	}))

	// WebSocket route for SSH (must be before other routes to avoid middleware conflicts)
	app.Use("/api/ssh/:id/ws", handlers.SSHWebSocketUpgrade)
	app.Get("/api/ssh/:id/ws", websocket.New(handlers.SSHWebSocket))

	// API routes
	api := app.Group("/api")

	// Rate limiter for auth endpoints (5 requests per minute per IP)
	authLimiter := limiter.New(limiter.Config{
		Max:        5,
		Expiration: 1 * time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			return c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "Too many login attempts. Please try again later.",
			})
		},
	})

	// Public routes (with rate limiting on auth)
	api.Get("/setup/status", handlers.CheckSetup)
	api.Post("/setup", authLimiter, handlers.Setup)
	api.Post("/login", authLimiter, handlers.Login)

	// TOTP verification (uses temp token, rate-limited)
	api.Post("/login/totp", authLimiter, middleware.TempAuthRequired(), handlers.LoginTOTP)

	// Protected routes
	protected := api.Group("", middleware.AuthRequired())
	protected.Get("/user", handlers.GetCurrentUser)

	// Admin-only routes
	admin := protected.Group("", middleware.AdminRequired())

	// User management routes (admin only)
	users := admin.Group("/users")
	users.Get("/", handlers.ListUsers)
	users.Post("/", handlers.CreateUser)
	users.Put("/:id", handlers.UpdateUser)
	users.Delete("/:id", handlers.DeleteUser)

	// Settings routes (admin only)
	admin.Get("/settings", handlers.GetSettings)
	admin.Put("/settings", handlers.UpdateSettings)

	// Audit log routes (admin only)
	audit := admin.Group("/audit")
	audit.Get("/logs", handlers.ListAuditLogs)
	audit.Get("/actions", handlers.GetAuditActions)

	// Machine routes
	machines := protected.Group("/machines")
	machines.Get("/", handlers.ListMachines)
	machines.Post("/", handlers.CreateMachine)
	machines.Get("/:id", handlers.GetMachine)
	machines.Put("/:id", handlers.UpdateMachine)
	machines.Delete("/:id", handlers.DeleteMachine)

	// Group routes
	groups := protected.Group("/groups")
	groups.Get("/", handlers.ListGroups)
	groups.Post("/", handlers.CreateGroup)
	groups.Put("/:id", handlers.UpdateGroup)
	groups.Delete("/:id", handlers.DeleteGroup)

	// SSH routes
	ssh := protected.Group("/ssh")
	ssh.Get("/:id/hostkey", handlers.GetHostKey)
	ssh.Put("/:id/hostkey", handlers.UpdateHostKey)

	// SFTP routes
	sftp := protected.Group("/sftp/:id")
	sftp.Get("/ls", handlers.SFTPListDirectory)
	sftp.Get("/download", handlers.SFTPDownloadFile)
	sftp.Post("/upload", handlers.SFTPUploadFile)
	sftp.Delete("/delete", handlers.SFTPDelete)
	sftp.Post("/mkdir", handlers.SFTPMakeDirectory)
	sftp.Post("/rename", handlers.SFTPRename)
	sftp.Get("/stat", handlers.SFTPStat)

	// Serve static files (frontend) in production
	if cfg.Production {
		app.Static("/", "./static")
		app.Get("/*", func(c *fiber.Ctx) error {
			return c.SendFile("./static/index.html")
		})
	}

	// Graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan

		log.Println("Shutting down server...")
		if err := app.Shutdown(); err != nil {
			log.Printf("Error shutting down: %v", err)
		}
	}()

	// Start server
	addr := fmt.Sprintf(":%s", cfg.ServerPort)
	log.Printf("Starting Farseer on %s", addr)
	if err := app.Listen(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}

	return c.Status(code).JSON(fiber.Map{
		"error": err.Error(),
	})
}
