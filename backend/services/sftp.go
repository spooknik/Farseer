package services

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// FileInfo represents information about a file or directory
type FileInfo struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	Mode    string `json:"mode"`
	ModTime int64  `json:"mod_time"`
	IsDir   bool   `json:"is_dir"`
}

// SFTPClient wraps an SFTP client
type SFTPClient struct {
	sshClient  *ssh.Client
	sftpClient *sftp.Client
}

// NewSFTPClient creates a new SFTP client from SSH config
func NewSFTPClient(cfg *SSHConfig) (*SFTPClient, error) {
	// First establish SSH connection
	session, _, err := ConnectSSH(cfg)
	if err != nil {
		return nil, err
	}

	// Create SFTP client
	sftpClient, err := sftp.NewClient(session.Client)
	if err != nil {
		session.Client.Close()
		return nil, fmt.Errorf("failed to create SFTP client: %w", err)
	}

	return &SFTPClient{
		sshClient:  session.Client,
		sftpClient: sftpClient,
	}, nil
}

// Close closes the SFTP and SSH clients
func (c *SFTPClient) Close() error {
	if c.sftpClient != nil {
		c.sftpClient.Close()
	}
	if c.sshClient != nil {
		c.sshClient.Close()
	}
	return nil
}

// ListDirectory lists the contents of a directory
func (c *SFTPClient) ListDirectory(path string) ([]FileInfo, error) {
	if path == "" {
		path = "."
	}

	// Get absolute path
	if !filepath.IsAbs(path) {
		wd, err := c.sftpClient.Getwd()
		if err != nil {
			return nil, fmt.Errorf("failed to get working directory: %w", err)
		}
		path = filepath.Join(wd, path)
	}

	entries, err := c.sftpClient.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %w", err)
	}

	files := make([]FileInfo, 0, len(entries))
	for _, entry := range entries {
		fullPath := filepath.Join(path, entry.Name())
		files = append(files, FileInfo{
			Name:    entry.Name(),
			Path:    fullPath,
			Size:    entry.Size(),
			Mode:    entry.Mode().String(),
			ModTime: entry.ModTime().Unix(),
			IsDir:   entry.IsDir(),
		})
	}

	// Sort: directories first, then by name
	sort.Slice(files, func(i, j int) bool {
		if files[i].IsDir != files[j].IsDir {
			return files[i].IsDir
		}
		return files[i].Name < files[j].Name
	})

	return files, nil
}

// GetWorkingDirectory returns the current working directory
func (c *SFTPClient) GetWorkingDirectory() (string, error) {
	return c.sftpClient.Getwd()
}

// DownloadFile downloads a file from the remote server
func (c *SFTPClient) DownloadFile(remotePath string) (io.ReadCloser, int64, error) {
	file, err := c.sftpClient.Open(remotePath)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to open remote file: %w", err)
	}

	stat, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, 0, fmt.Errorf("failed to stat file: %w", err)
	}

	if stat.IsDir() {
		file.Close()
		return nil, 0, fmt.Errorf("cannot download a directory")
	}

	return file, stat.Size(), nil
}

// UploadFile uploads a file to the remote server
func (c *SFTPClient) UploadFile(remotePath string, content io.Reader, size int64) error {
	// Ensure parent directory exists
	dir := filepath.Dir(remotePath)
	if err := c.sftpClient.MkdirAll(dir); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	file, err := c.sftpClient.Create(remotePath)
	if err != nil {
		return fmt.Errorf("failed to create remote file: %w", err)
	}
	defer file.Close()

	_, err = io.Copy(file, content)
	if err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

// DeleteFile deletes a file or empty directory
func (c *SFTPClient) DeleteFile(remotePath string) error {
	stat, err := c.sftpClient.Stat(remotePath)
	if err != nil {
		return fmt.Errorf("failed to stat path: %w", err)
	}

	if stat.IsDir() {
		return c.sftpClient.RemoveDirectory(remotePath)
	}
	return c.sftpClient.Remove(remotePath)
}

// MakeDirectory creates a directory
func (c *SFTPClient) MakeDirectory(remotePath string) error {
	return c.sftpClient.MkdirAll(remotePath)
}

// Rename renames/moves a file or directory
func (c *SFTPClient) Rename(oldPath, newPath string) error {
	return c.sftpClient.Rename(oldPath, newPath)
}

// Stat returns information about a file or directory
func (c *SFTPClient) Stat(path string) (*FileInfo, error) {
	stat, err := c.sftpClient.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("path does not exist: %s", path)
		}
		return nil, fmt.Errorf("failed to stat path: %w", err)
	}

	return &FileInfo{
		Name:    stat.Name(),
		Path:    path,
		Size:    stat.Size(),
		Mode:    stat.Mode().String(),
		ModTime: stat.ModTime().Unix(),
		IsDir:   stat.IsDir(),
	}, nil
}
