```
 ███████╗ █████╗ ██████╗ ███████╗███████╗███████╗██████╗
 ██╔════╝██╔══██╗██╔══██╗██╔════╝██╔════╝██╔════╝██╔══██╗
 █████╗  ███████║██████╔╝███████╗█████╗  █████╗  ██████╔╝
 ██╔══╝  ██╔══██║██╔══██╗╚════██║██╔══╝  ██╔══╝  ██╔══██╗
 ██║     ██║  ██║██║  ██║███████║███████╗███████╗██║  ██║
 ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝
```

A self-hosted web-based SSH gateway. Store SSH connections, open terminal sessions from your browser, transfer files over SFTP, and manage everything from a terminal-inspired UI.

## Features

- **Browser-based SSH terminals** powered by xterm.js with full color, resize, and clipboard support
- **Split panes** — divide any terminal tab vertically or horizontally, connect each pane to a different machine
- **Session tabs** — keep multiple connections alive simultaneously, switch between them without disconnecting
- **SFTP file manager** — browse, upload, download, and delete files on remote machines
- **Machine groups** — organize connections with collapsible groups and tree-view navigation
- **Multi-user support** — admin and user roles with per-user isolated machine lists
- **Audit logging** — every SSH connection, SFTP operation, and user action is logged with timestamps and IP addresses
- **Host key verification** — Trust On First Use (TOFU) model with mismatch warnings, matching OpenSSH behavior
- **Keyboard shortcuts** — tmux-style split controls, tab switching, and quick navigation

## Security

Since Farseer stores SSH credentials (passwords and private keys) that grant access to remote servers, the security model is designed with multiple layers of defense. This section explains exactly how credentials are protected at rest, in transit, and in memory.

### Credential Encryption (At Rest)

SSH credentials are **never stored in plaintext**. Every password and private key is encrypted before it reaches the database using the following scheme:

1. **AES-256-GCM** — Credentials are encrypted with AES-256 in Galois/Counter Mode, which provides both confidentiality and authentication (tamper detection). A random 16-byte salt and 12-byte nonce are generated per credential using `crypto/rand`.

2. **PBKDF2 key derivation** — The encryption key is derived using PBKDF2 with **100,000 iterations** of SHA-256. The input to PBKDF2 combines the user's client-derived key with a server-side secret, meaning both components are required to decrypt.

3. **Two-part key material** — The decryption key cannot be reconstructed from the server alone:
   - **Client side**: The browser derives a key from the user's password using PBKDF2 (Web Crypto API, 100K iterations, username-salted). This derived key is held in `localStorage` and sent over the WebSocket during SSH connection setup. The user's raw password is never stored client-side.
   - **Server side**: A randomly generated `server_secret` (256-bit) is stored in the server's config file (`~/.farseer/config.json`). It is combined with the client key before running PBKDF2 again server-side.

   This means: if an attacker obtains the SQLite database, they **cannot decrypt any credentials** without also having both the user's password and the server secret. If the server config is compromised but the database is not (or vice versa), credentials remain protected.

4. **Per-credential randomness** — Each credential gets its own random salt and nonce. Encrypting the same password twice produces completely different ciphertext.

### Authentication & Session Management

- **Password hashing** — User login passwords are hashed with **bcrypt** (default cost factor). Raw passwords are never stored.
- **JWT tokens** — Sessions use HS256-signed JWTs with a **24-hour expiration**, signed with a randomly generated 256-bit secret. Tokens are validated on every API request and on WebSocket upgrade.
- **Role-based access** — Admin and user roles enforced server-side via middleware. User management and audit log endpoints require admin role.
- **Rate limiting** — Login and setup endpoints are rate-limited to **5 requests per minute per IP** to mitigate brute-force attacks.

### In Transit

- **HTTPS required for production** — The Web Crypto API (`crypto.subtle`) used for client-side key derivation requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) (HTTPS or localhost). Farseer will not function correctly over plain HTTP on non-localhost addresses. Deploy behind a reverse proxy with TLS (nginx, Caddy, Traefik, etc.).
- **WebSocket credential delivery** — The client-derived encryption key is sent over the WebSocket connection (which inherits HTTPS encryption) during the SSH handshake, not as an HTTP header or query parameter. It is only held in server memory for the duration of the connection and is not logged or persisted.

### Host Key Verification

Farseer implements **Trust On First Use (TOFU)**, the same model used by OpenSSH:

- On first connection to a host, the server's SSH fingerprint (SHA-256) is presented to the user for manual verification before being stored.
- On subsequent connections, the stored fingerprint is compared. If it matches, the connection proceeds silently. If it has changed, a warning is shown explaining the potential for a man-in-the-middle attack, and the user must explicitly accept the new key.
- Host key fingerprints are stored per-machine in the database.

### Data Isolation

- Each user can only see and connect to their own machines. All machine queries are scoped by `user_id` in the database.
- The `CredentialEncrypted` field is excluded from all JSON API responses (tagged `json:"-"`), so encrypted blobs are never sent to the client.
- The `PasswordHash` field on user accounts is also excluded from API responses.

### Deployment Recommendations

- **Always use HTTPS** in production — required for security and for `crypto.subtle` to function.
- **Protect the config file** — `~/.farseer/config.json` (or `/data/config.json` in Docker) contains the `server_secret` and `jwt_secret`. File permissions are set to `0600` by default. Back it up securely — if lost, all stored credentials become undecryptable.
- **Protect the database** — `farseer.db` contains encrypted credentials. While they can't be decrypted without the server secret + user password, treat it as sensitive.
- **Use a reverse proxy** — Farseer does not handle TLS directly. Place it behind nginx, Caddy, or Traefik with a valid certificate.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Go, Fiber, GORM |
| Frontend | React, TypeScript, Vite |
| Database | SQLite (pure Go driver, no CGO required) |
| Terminal | xterm.js |
| Styling | Tailwind CSS |
| SSH | `golang.org/x/crypto/ssh`, `github.com/pkg/sftp` |

## Getting Started

### Development

Run the backend and frontend in separate terminals:

```bash
# Terminal 1 — backend
cd backend
go mod tidy
go run .

# Terminal 2 — frontend
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The frontend proxies API requests to the backend on port 8080.

On first visit, you'll be prompted to create an admin account.

### Docker

```bash
docker-compose up --build
```

Open http://localhost:8080. In production, place this behind a TLS-terminating reverse proxy.

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `FARSEER_PORT` | HTTP listen port | `8080` |
| `FARSEER_CONFIG_DIR` | Directory for config and database | `~/.farseer` |
| `FARSEER_DB_PATH` | SQLite database file path | `<config_dir>/farseer.db` |
| `FARSEER_PRODUCTION` | Set to `true` to serve static frontend | `false` |

## Project Structure

```
farseer/
├── backend/
│   ├── main.go              # Routes, middleware, server setup
│   ├── config/              # Configuration management
│   ├── database/            # SQLite + GORM connection
│   ├── handlers/            # HTTP/WebSocket handlers
│   │   ├── auth.go          # Login, setup, user CRUD
│   │   ├── machines.go      # Machine CRUD
│   │   ├── sftp.go          # File transfer endpoints
│   │   └── ssh.go           # WebSocket SSH terminal
│   ├── middleware/           # JWT auth, role checks
│   ├── models/              # User, Machine, Group, AuditLog
│   └── services/            # Crypto, SSH, SFTP, audit
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Layout, tabs, session management
│   │   ├── components/
│   │   │   ├── Login.tsx    # Auth with ASCII art branding
│   │   │   ├── MachineList.tsx  # Sidebar with tree view
│   │   │   ├── Terminal.tsx     # xterm.js wrapper
│   │   │   ├── TerminalPane.tsx # Split-aware terminal
│   │   │   ├── SplitTerminalContainer.tsx # Binary tree split manager
│   │   │   ├── FileManager.tsx  # SFTP browser
│   │   │   ├── MachineForm.tsx  # Add/edit machine modal
│   │   │   ├── UserManagement.tsx # Admin user CRUD
│   │   │   └── AuditLogs.tsx    # Admin audit viewer
│   │   ├── services/api.ts  # Axios API client
│   │   ├── hooks/           # Keyboard shortcuts, WebSocket
│   │   └── utils/crypto.ts  # Client-side PBKDF2 key derivation
│   ├── tailwind.config.js
│   └── vite.config.ts
├── Dockerfile
└── docker-compose.yml
```

## API Overview

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/setup/status` | No | Check if initial setup is done |
| `POST` | `/api/setup` | No | Create admin account (first run) |
| `POST` | `/api/login` | No | Authenticate, returns JWT |
| `GET` | `/api/user` | JWT | Get current user |
| `GET/POST/PUT/DELETE` | `/api/machines/*` | JWT | Machine CRUD |
| `GET/POST/PUT/DELETE` | `/api/groups/*` | JWT | Group CRUD |
| `WS` | `/api/ssh/:id/ws` | JWT | WebSocket terminal session |
| `GET/POST/DELETE` | `/api/sftp/:id/*` | JWT | SFTP operations |
| `GET/POST/PUT/DELETE` | `/api/users/*` | Admin | User management |
| `GET` | `/api/audit/*` | Admin | Audit logs |

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+T` | New connection |
| `Ctrl+W` | Close current tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+Shift+D` | Split pane vertically |
| `Ctrl+Shift+E` | Split pane horizontally |
| `Ctrl+Shift+X` | Close focused pane |
| `Ctrl+Alt+Arrow` | Navigate between panes |
| `Ctrl+/` | Toggle shortcuts help |
