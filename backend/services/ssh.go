package services

import (
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// SSHSession represents an active SSH session
type SSHSession struct {
	Client  *ssh.Client
	Session *ssh.Session
	Stdin   io.WriteCloser
	Stdout  io.Reader
	Stderr  io.Reader
	mu      sync.Mutex
}

// SSHConfig holds the configuration for an SSH connection
type SSHConfig struct {
	Hostname        string
	Port            int
	Username        string
	Password        string
	PrivateKey      string
	Passphrase      string
	HostKey         string // Expected host key fingerprint (for verification)
	SkipHostKeyCheck bool   // If true, don't fail on host key mismatch (for user confirmation flow)
}

// HostKeyResult contains information about the host key verification
type HostKeyResult struct {
	Fingerprint string
	Status      string // "new", "match", "mismatch"
}

// ConnectSSH establishes an SSH connection
func ConnectSSH(cfg *SSHConfig) (*SSHSession, *HostKeyResult, error) {
	var authMethods []ssh.AuthMethod

	// Configure authentication
	if cfg.Password != "" {
		authMethods = append(authMethods, ssh.Password(cfg.Password))
	}

	if cfg.PrivateKey != "" {
		var signer ssh.Signer
		var err error

		if cfg.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(cfg.PrivateKey), []byte(cfg.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(cfg.PrivateKey))
		}

		if err != nil {
			return nil, nil, fmt.Errorf("failed to parse private key: %w", err)
		}

		authMethods = append(authMethods, ssh.PublicKeys(signer))
	}

	if len(authMethods) == 0 {
		return nil, nil, errors.New("no authentication method provided")
	}

	// Host key callback for verification
	hostKeyResult := &HostKeyResult{}
	var hostKeyErr error

	hostKeyCallback := func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		hostKeyResult.Fingerprint = ssh.FingerprintSHA256(key)

		if cfg.HostKey == "" {
			// First connection - new host key
			hostKeyResult.Status = "new"
		} else if cfg.HostKey == hostKeyResult.Fingerprint {
			// Host key matches
			hostKeyResult.Status = "match"
		} else {
			// Host key mismatch!
			hostKeyResult.Status = "mismatch"
			if !cfg.SkipHostKeyCheck {
				hostKeyErr = fmt.Errorf("host key mismatch: expected %s, got %s", cfg.HostKey, hostKeyResult.Fingerprint)
				return hostKeyErr
			}
		}

		return nil
	}

	sshConfig := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCallback,
		Timeout:         30 * time.Second,
	}

	// Connect
	addr := fmt.Sprintf("%s:%d", cfg.Hostname, cfg.Port)
	client, err := ssh.Dial("tcp", addr, sshConfig)
	if err != nil {
		// If it's a host key error, still return the result for user confirmation
		if hostKeyErr != nil {
			return nil, hostKeyResult, err
		}
		return nil, nil, fmt.Errorf("failed to connect: %w", err)
	}

	return &SSHSession{
		Client: client,
	}, hostKeyResult, nil
}

// StartShell starts an interactive shell session
func (s *SSHSession) StartShell(rows, cols int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, err := s.Client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}
	s.Session = session

	// Request pseudo terminal
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		session.Close()
		return fmt.Errorf("failed to request PTY: %w", err)
	}

	// Get stdin pipe
	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		return fmt.Errorf("failed to get stdin pipe: %w", err)
	}
	s.Stdin = stdin

	// Get stdout pipe
	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		return fmt.Errorf("failed to get stdout pipe: %w", err)
	}
	s.Stdout = stdout

	// Get stderr pipe
	stderr, err := session.StderrPipe()
	if err != nil {
		session.Close()
		return fmt.Errorf("failed to get stderr pipe: %w", err)
	}
	s.Stderr = stderr

	// Start shell
	if err := session.Shell(); err != nil {
		session.Close()
		return fmt.Errorf("failed to start shell: %w", err)
	}

	return nil
}

// Resize changes the terminal size
func (s *SSHSession) Resize(rows, cols int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.Session == nil {
		return errors.New("no active session")
	}

	return s.Session.WindowChange(rows, cols)
}

// Write sends data to the SSH session
func (s *SSHSession) Write(data []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.Stdin == nil {
		return 0, errors.New("no active session")
	}

	return s.Stdin.Write(data)
}

// Close closes the SSH session and client
func (s *SSHSession) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var errs []error

	if s.Stdin != nil {
		if err := s.Stdin.Close(); err != nil {
			errs = append(errs, err)
		}
	}

	if s.Session != nil {
		if err := s.Session.Close(); err != nil {
			errs = append(errs, err)
		}
	}

	if s.Client != nil {
		if err := s.Client.Close(); err != nil {
			errs = append(errs, err)
		}
	}

	if len(errs) > 0 {
		return errs[0]
	}
	return nil
}
