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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-800 rounded-lg w-full max-w-4xl h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-xl font-semibold text-white">
            File Manager - {machine.name}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 p-4 border-b border-slate-700">
          <button
            onClick={handleGoUp}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
            title="Go up"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </button>
          <button
            onClick={() => fetchDirectory(currentPath)}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
            title="Refresh"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <div className="flex-1 px-3 py-1 bg-slate-700 rounded text-slate-300 text-sm truncate">
            {currentPath || '/'}
          </div>
          <button
            onClick={() => setShowNewFolderDialog(true)}
            className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors"
          >
            New Folder
          </button>
          <label className={`px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded cursor-pointer transition-colors ${uploadProgress ? 'opacity-50 pointer-events-none' : ''}`}>
            {uploadProgress ? 'Uploading...' : 'Upload'}
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
          <div className="px-4 py-2 border-b border-slate-700">
            <div className="flex items-center gap-2 text-sm text-slate-300 mb-1">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="truncate">Uploading: {uploadProgress.name}</span>
              <span className="ml-auto">{uploadProgress.percent}%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-1.5">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all duration-200"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </div>
          </div>
        )}

        {/* File list */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-slate-400">
              Loading...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-red-400">
              {error}
            </div>
          ) : files.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-400">
              Empty directory
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-slate-700/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-slate-300">Name</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-slate-300 w-24">Size</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-slate-300 w-44">Modified</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-slate-300 w-24">Mode</th>
                  <th className="px-4 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {files.map((file) => (
                  <tr
                    key={file.path}
                    className={`hover:bg-slate-700/50 cursor-pointer ${
                      selectedFiles.has(file.path) ? 'bg-blue-500/20' : ''
                    }`}
                    onClick={() => toggleSelect(file.path)}
                    onDoubleClick={() => handleNavigate(file)}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {file.is_dir ? (
                          <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-slate-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                          </svg>
                        )}
                        <span className="text-white truncate">{file.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-slate-400 text-sm">
                      {file.is_dir ? '-' : formatFileSize(file.size)}
                    </td>
                    <td className="px-4 py-2 text-slate-400 text-sm">
                      {formatDate(file.mod_time)}
                    </td>
                    <td className="px-4 py-2 text-slate-400 text-sm font-mono">
                      {file.mode}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        {!file.is_dir && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(file);
                            }}
                            className="p-1 text-slate-400 hover:text-white transition-colors"
                            title="Download"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(file);
                          }}
                          className="p-1 text-slate-400 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
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
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="bg-slate-700 rounded-lg p-4 w-80">
              <h3 className="text-white font-medium mb-4">New Folder</h3>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white mb-4"
                placeholder="Folder name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') setShowNewFolderDialog(false);
                }}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowNewFolderDialog(false)}
                  className="px-3 py-1.5 text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFolder}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
