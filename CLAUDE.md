# Farseer

A secure web-based SSH client that allows users to store SSH connection info and connect to remote machines via browser-based terminal sessions.

## Tech Stack

- **Backend**: Go with Fiber web framework
- **Frontend**: React + TypeScript with Vite
- **Database**: SQLite (pure Go driver - no CGO required)
- **Terminal**: xterm.js
- **Styling**: Tailwind CSS

## Project Structure

```
farseer/
├── backend/
│   ├── main.go                 # Entry point, routes
│   ├── config/config.go        # Configuration management
│   ├── database/db.go          # SQLite + GORM setup
│   ├── handlers/
│   │   ├── auth.go             # Login/setup endpoints
│   │   ├── machines.go         # Machine CRUD
│   │   ├── sftp.go             # File transfer endpoints
│   │   └── ssh.go              # WebSocket SSH handler
│   ├── middleware/auth.go      # JWT authentication
│   ├── models/
│   │   ├── user.go             # User model
│   │   └── machine.go          # Machine model
│   └── services/
│       ├── crypto.go           # AES-256-GCM encryption
│       ├── sftp.go             # SFTP client
│       └── ssh.go              # SSH connection service
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Main app with session management
│   │   ├── components/
│   │   │   ├── Login.tsx       # Auth UI with setup wizard
│   │   │   ├── MachineList.tsx # Sidebar machine list
│   │   │   ├── MachineForm.tsx # Add/edit machine modal
│   │   │   ├── Terminal.tsx    # xterm.js terminal
│   │   │   └── FileManager.tsx # SFTP file browser
│   │   ├── services/api.ts     # API client
│   │   ├── hooks/useWebSocket.ts
│   │   └── types/index.ts
│   ├── package.json
│   └── vite.config.ts
├── Dockerfile
├── docker-compose.yml
└── .gitignore
```

## Running the Application

### Development

**Backend** (terminal 1):
```bash
cd backend
go mod tidy
go run .
```

**Frontend** (terminal 2):
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

### Docker

```bash
docker-compose up --build
```

Open http://localhost:8080

## API Endpoints

### Authentication
- `GET /api/setup/status` - Check if initial setup is complete
- `POST /api/setup` - Create admin account (first run only)
- `POST /api/login` - Login, returns JWT token

### Machines (requires auth)
- `GET /api/machines/` - List all machines
- `POST /api/machines/` - Create machine
- `GET /api/machines/:id` - Get machine
- `PUT /api/machines/:id` - Update machine
- `DELETE /api/machines/:id` - Delete machine

### SSH (requires auth)
- `WS /api/ssh/:id/ws` - WebSocket terminal session
- `GET /api/ssh/:id/hostkey` - Get stored host key
- `PUT /api/ssh/:id/hostkey` - Update host key

### SFTP (requires auth)
- `GET /api/sftp/:id/ls` - List directory
- `GET /api/sftp/:id/download` - Download file
- `POST /api/sftp/:id/upload` - Upload file
- `DELETE /api/sftp/:id/delete` - Delete file
- `POST /api/sftp/:id/mkdir` - Create directory
- `POST /api/sftp/:id/rename` - Rename/move file

## Security

- **Credential encryption**: SSH passwords/keys encrypted with AES-256-GCM
- **Key derivation**: PBKDF2 with 100k iterations (user password + server secret)
- **Password hashing**: bcrypt for web app login
- **JWT tokens**: 24-hour expiration, validated on WebSocket upgrade
- **Host key verification**: Trust On First Use (TOFU), warns on changes

## Key Features

- Password and private key SSH authentication
- Passphrase-protected key support
- Persistent terminal sessions (switch machines without disconnecting)
- Session tabs for multiple simultaneous connections
- SFTP file manager (browse, upload, download)
- Terminal resize handling
- Host key verification

## Configuration

Config stored in `~/.farseer/config.json` (auto-generated on first run):
- `server_port`: HTTP port (default: 8080)
- `database_path`: SQLite database location
- `server_secret`: Used for credential encryption (auto-generated)
- `jwt_secret`: Used for JWT signing (auto-generated)

Environment variables:
- `FARSEER_PORT` - Override server port
- `FARSEER_CONFIG_DIR` - Config directory path
- `FARSEER_DB_PATH` - Database file path
- `FARSEER_PRODUCTION` - Set to "true" for production mode

## Database

SQLite with two tables:
- `users` - Web app accounts (id, username, password_hash)
- `machines` - SSH connections (id, user_id, name, hostname, port, username, auth_type, credential_encrypted, host_key)

## Dependencies

### Backend (Go)
- `github.com/gofiber/fiber/v2` - Web framework
- `github.com/gofiber/contrib/websocket` - WebSocket support
- `github.com/glebarez/sqlite` - Pure Go SQLite driver
- `gorm.io/gorm` - ORM
- `golang.org/x/crypto/ssh` - SSH client
- `github.com/pkg/sftp` - SFTP client
- `github.com/golang-jwt/jwt/v5` - JWT tokens

### Frontend (npm)
- `react`, `react-dom`, `react-router-dom`
- `xterm`, `xterm-addon-fit`, `xterm-addon-web-links`
- `axios`
- `tailwindcss`
