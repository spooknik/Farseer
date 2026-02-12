import { useState, useEffect, useCallback, useRef } from 'react';
import { listDirectory, downloadFile, uploadFile, deleteFile, makeDirectory } from '../services/api';
import type { Machine, FileInfo } from '../types';

interface FileManagerProps {
  machine: Machine;
  onClose: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

export default function FileManager({ machine, onClose }: FileManagerProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [uploadProgress, setUploadProgress] = useState<{ name: string; percent: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle Escape key to close modal
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (showNewFolderDialog) {
        setShowNewFolderDialog(false);
      } else {
        onClose();
      }
    }
  }, [showNewFolderDialog, onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const fetchDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError('');
    setSelectedFiles(new Set());

    try {
      const result = await listDirectory(machine.id, path);
      setFiles(result.files);
      setCurrentPath(result.path || result.cwd);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  }, [machine.id]);

  useEffect(() => {
    fetchDirectory('');
  }, [fetchDirectory]);

  const handleNavigate = (file: FileInfo) => {
    if (file.is_dir) {
      fetchDirectory(file.path);
    }
  };

  const handleGoUp = () => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    fetchDirectory(parentPath);
  };

  const handleDownload = async (file: FileInfo) => {
    try {
      const blob = await downloadFile(machine.id, file.path);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      alert(error.response?.data?.error || 'Failed to download file');
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    try {
      for (const file of files) {
        setUploadProgress({ name: file.name, percent: 0 });
        await uploadFile(machine.id, currentPath, file, (percent) => {
          setUploadProgress({ name: file.name, percent });
        });
      }
      setUploadProgress(null);
      fetchDirectory(currentPath);
    } catch (err: unknown) {
      setUploadProgress(null);
      const error = err as { response?: { data?: { error?: string } } };
      alert(error.response?.data?.error || 'Failed to upload file');
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (file: FileInfo) => {
    if (!confirm(`Delete "${file.name}"?`)) return;

    try {
      await deleteFile(machine.id, file.path);
      fetchDirectory(currentPath);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      alert(error.response?.data?.error || 'Failed to delete file');
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    try {
      const path = currentPath ? `${currentPath}/${newFolderName}` : newFolderName;
      await makeDirectory(machine.id, path);
      setShowNewFolderDialog(false);
      setNewFolderName('');
      fetchDirectory(currentPath);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      alert(error.response?.data?.error || 'Failed to create folder');
    }
  };

  const toggleSelect = (path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="border border-term-border bg-term-surface w-full max-w-4xl h-[80vh] flex flex-col">
        {/* Title bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-term-surface-alt border-b border-term-border">
          <span className="text-xs text-term-fg-dim font-mono">
            --[ sftp :: {machine.name} ]--
          </span>
          <button
            onClick={onClose}
            className="text-xs text-term-fg-dim hover:text-term-red font-mono transition-colors"
          >
            [x]
          </button>
        </div>

        {/* Toolbar / Path bar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-term-border">
          <button
            onClick={handleGoUp}
            className="text-xs text-term-fg-dim hover:text-term-fg font-mono transition-colors"
            title="Go up"
          >
            [..]
          </button>
          <button
            onClick={() => fetchDirectory(currentPath)}
            className="text-xs text-term-fg-dim hover:text-term-fg font-mono transition-colors"
            title="Refresh"
          >
            [r]
          </button>
          <div className="flex-1 px-2 py-0.5 bg-term-surface-alt border border-term-border text-term-fg text-xs font-mono truncate">
            <span className="text-term-cyan">$ </span>{currentPath || '/'}
          </div>
          <button
            onClick={() => setShowNewFolderDialog(true)}
            className="text-xs text-term-fg-dim hover:text-term-fg font-mono border border-term-border px-2 py-0.5 transition-colors"
          >
            [mkdir]
          </button>
          <label className={`text-xs text-term-fg font-mono border border-term-cyan px-2 py-0.5 cursor-pointer hover:bg-term-cyan/10 transition-colors ${uploadProgress ? 'opacity-50 pointer-events-none' : ''}`}>
            {uploadProgress ? '[uploading...]' : '[upload]'}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleUpload}
              disabled={!!uploadProgress}
            />
          </label>
        </div>

        {/* Upload progress bar */}
        {uploadProgress && (
          <div className="px-3 py-1.5 border-b border-term-border">
            <div className="flex items-center gap-2 text-xs text-term-fg-dim font-mono mb-1">
              <span className="truncate">uploading: {uploadProgress.name}</span>
              <span className="ml-auto">{uploadProgress.percent}%</span>
            </div>
            <div className="w-full bg-term-surface-alt h-1">
              <div
                className="bg-term-cyan h-1 transition-all duration-200"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </div>
          </div>
        )}

        {/* File list */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-term-fg-dim text-xs font-mono">
              loading...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-term-red text-xs font-mono">
              [ERR] {error}
            </div>
          ) : files.length === 0 ? (
            <div className="flex items-center justify-center h-full text-term-fg-dim text-xs font-mono">
              empty directory
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-term-surface-alt sticky top-0">
                <tr>
                  <th className="px-3 py-1.5 text-left text-xs font-normal text-term-fg-dim border-b border-term-border font-mono">name</th>
                  <th className="px-3 py-1.5 text-left text-xs font-normal text-term-fg-dim border-b border-term-border font-mono w-24">size</th>
                  <th className="px-3 py-1.5 text-left text-xs font-normal text-term-fg-dim border-b border-term-border font-mono w-44">modified</th>
                  <th className="px-3 py-1.5 text-left text-xs font-normal text-term-fg-dim border-b border-term-border font-mono w-24">mode</th>
                  <th className="px-3 py-1.5 border-b border-term-border w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-term-border">
                {files.map((file) => (
                  <tr
                    key={file.path}
                    className={`hover:bg-term-surface-alt cursor-pointer ${
                      selectedFiles.has(file.path) ? 'bg-term-cyan/10' : ''
                    }`}
                    onClick={() => toggleSelect(file.path)}
                    onDoubleClick={() => handleNavigate(file)}
                  >
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2 font-mono text-xs">
                        {file.is_dir ? (
                          <span className="text-term-cyan">d</span>
                        ) : (
                          <span className="text-term-fg-dim">-</span>
                        )}
                        <span className={file.is_dir ? 'text-term-cyan truncate' : 'text-term-fg truncate'}>
                          {file.name}{file.is_dir ? '/' : ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-term-fg-dim text-xs font-mono">
                      {file.is_dir ? '-' : formatFileSize(file.size)}
                    </td>
                    <td className="px-3 py-1.5 text-term-fg-dim text-xs font-mono">
                      {formatDate(file.mod_time)}
                    </td>
                    <td className="px-3 py-1.5 text-term-fg-dim text-xs font-mono">
                      {file.mode}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1 font-mono">
                        {!file.is_dir && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(file);
                            }}
                            className="text-xs text-term-fg-dim hover:text-term-fg transition-colors"
                            title="Download"
                          >
                            [dl]
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(file);
                          }}
                          className="text-xs text-term-fg-dim hover:text-term-red transition-colors"
                          title="Delete"
                        >
                          [x]
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* New folder dialog */}
        {showNewFolderDialog && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <div className="border border-term-border bg-term-surface w-80">
              <div className="px-3 py-1.5 bg-term-surface-alt border-b border-term-border flex items-center justify-between">
                <span className="text-xs text-term-fg-dim font-mono">--[ mkdir ]--</span>
                <button
                  onClick={() => setShowNewFolderDialog(false)}
                  className="text-xs text-term-fg-dim hover:text-term-red font-mono transition-colors"
                >
                  [x]
                </button>
              </div>
              <div className="p-3">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full px-2 py-1 bg-term-surface-alt border border-term-border text-term-fg text-xs font-mono mb-3 focus:outline-none focus:border-term-cyan"
                  placeholder="folder name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateFolder();
                    if (e.key === 'Escape') setShowNewFolderDialog(false);
                  }}
                />
                <div className="flex justify-end gap-2 font-mono">
                  <button
                    onClick={() => setShowNewFolderDialog(false)}
                    className="text-xs text-term-fg-dim hover:text-term-fg transition-colors"
                  >
                    [ cancel ]
                  </button>
                  <button
                    onClick={handleCreateFolder}
                    className="text-xs text-term-fg border border-term-cyan px-2 py-0.5 hover:bg-term-cyan/10 transition-colors"
                  >
                    [ create ]
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
