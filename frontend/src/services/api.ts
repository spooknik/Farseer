import axios from 'axios';
import type { AuthResponse, Machine, MachineInput, SetupStatus, User, UserInput, DirectoryListing, Group, GroupInput, AuditLogResponse, AuditAction } from '../types';

const api = axios.create({
  baseURL: '/api',
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const encryptionKey = localStorage.getItem('encryptionKey');
  if (encryptionKey) {
    config.headers['X-Encryption-Key'] = encryptionKey;
  }
  return config;
});

// Handle 401 errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('encryptionKey');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth endpoints
export const checkSetupStatus = async (): Promise<SetupStatus> => {
  const response = await api.get('/setup/status');
  return response.data;
};

export const setup = async (username: string, password: string): Promise<AuthResponse> => {
  const response = await api.post('/setup', { username, password });
  return response.data;
};

export const login = async (username: string, password: string): Promise<AuthResponse> => {
  const response = await api.post('/login', { username, password });
  return response.data;
};

export const getCurrentUser = async (): Promise<User> => {
  const response = await api.get('/user');
  return response.data;
};

// User management endpoints (admin only)
export const listUsers = async (): Promise<User[]> => {
  const response = await api.get('/users/');
  return response.data;
};

export const createUser = async (user: UserInput): Promise<User> => {
  const response = await api.post('/users/', user);
  return response.data;
};

export const updateUser = async (id: number, user: Partial<UserInput>): Promise<User> => {
  const response = await api.put(`/users/${id}`, user);
  return response.data;
};

export const deleteUser = async (id: number): Promise<void> => {
  await api.delete(`/users/${id}`);
};

// Machine endpoints
export const listMachines = async (): Promise<Machine[]> => {
  const response = await api.get('/machines/');
  return response.data;
};

export const getMachine = async (id: number): Promise<Machine> => {
  const response = await api.get(`/machines/${id}`);
  return response.data;
};

export const createMachine = async (machine: MachineInput): Promise<Machine> => {
  const response = await api.post('/machines/', machine);
  return response.data;
};

export const updateMachine = async (id: number, machine: Partial<MachineInput>): Promise<Machine> => {
  const response = await api.put(`/machines/${id}`, machine);
  return response.data;
};

export const deleteMachine = async (id: number): Promise<void> => {
  await api.delete(`/machines/${id}`);
};

// Group endpoints
export const listGroups = async (): Promise<Group[]> => {
  const response = await api.get('/groups/');
  return response.data;
};

export const createGroup = async (group: GroupInput): Promise<Group> => {
  const response = await api.post('/groups/', group);
  return response.data;
};

export const updateGroup = async (id: number, group: Partial<GroupInput>): Promise<Group> => {
  const response = await api.put(`/groups/${id}`, group);
  return response.data;
};

export const deleteGroup = async (id: number): Promise<void> => {
  await api.delete(`/groups/${id}`);
};

// SSH endpoints
export const getHostKey = async (id: number): Promise<{ host_key: string }> => {
  const response = await api.get(`/ssh/${id}/hostkey`);
  return response.data;
};

export const updateHostKey = async (id: number, hostKey: string): Promise<void> => {
  await api.put(`/ssh/${id}/hostkey`, { host_key: hostKey });
};

// SFTP endpoints
export const listDirectory = async (machineId: number, path?: string): Promise<DirectoryListing> => {
  const response = await api.get(`/sftp/${machineId}/ls`, {
    params: { path },
  });
  return response.data;
};

export const downloadFile = async (machineId: number, path: string): Promise<Blob> => {
  const response = await api.get(`/sftp/${machineId}/download`, {
    params: { path },
    responseType: 'blob',
  });
  return response.data;
};

export const uploadFile = async (
  machineId: number,
  path: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> => {
  const formData = new FormData();
  formData.append('file', file);
  await api.post(`/sftp/${machineId}/upload`, formData, {
    params: { path },
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress(percent);
      }
    },
  });
};

export const deleteFile = async (machineId: number, path: string): Promise<void> => {
  await api.delete(`/sftp/${machineId}/delete`, {
    params: { path },
  });
};

export const makeDirectory = async (machineId: number, path: string): Promise<void> => {
  await api.post(`/sftp/${machineId}/mkdir`, { path });
};

export const renameFile = async (machineId: number, oldPath: string, newPath: string): Promise<void> => {
  await api.post(`/sftp/${machineId}/rename`, { old_path: oldPath, new_path: newPath });
};

// Audit log endpoints (admin only)
export const listAuditLogs = async (params?: {
  page?: number;
  limit?: number;
  action?: AuditAction;
  user_id?: number;
  machine_id?: number;
}): Promise<AuditLogResponse> => {
  const response = await api.get('/audit/logs', { params });
  return response.data;
};

export const getAuditActions = async (): Promise<AuditAction[]> => {
  const response = await api.get('/audit/actions');
  return response.data;
};

// Helper to get WebSocket URL (no longer includes encryption key for security)
export const getSSHWebSocketUrl = (machineId: number, userId: number): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const token = localStorage.getItem('token') || '';
  return `${protocol}//${host}/api/ssh/${machineId}/ws?user_id=${userId}&token=${encodeURIComponent(token)}`;
};

export default api;
