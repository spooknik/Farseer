export type Role = 'admin' | 'user';

export interface User {
  id: number;
  username: string;
  role: Role;
  created_at: string;
}

export interface UserInput {
  username: string;
  password: string;
  role: Role;
}

export interface Machine {
  id: number;
  group_id?: number | null;
  name: string;
  hostname: string;
  port: number;
  username: string;
  auth_type: 'password' | 'key';
  host_key?: string;
  created_at: string;
  updated_at: string;
}

export interface MachineInput {
  name: string;
  group_id?: number | null;
  hostname: string;
  port: number;
  username: string;
  auth_type: 'password' | 'key';
  credential: string;
  passphrase?: string;
}

export interface Group {
  id: number;
  user_id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface GroupInput {
  name: string;
  color?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface SetupStatus {
  setup_complete: boolean;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  mode: string;
  mod_time: number;
  is_dir: boolean;
}

export interface DirectoryListing {
  cwd: string;
  path: string;
  files: FileInfo[];
}

export interface WSMessage {
  type: string;
  data: unknown;
}

export type AuditAction =
  | 'login'
  | 'logout'
  | 'ssh_connect'
  | 'ssh_disconnect'
  | 'sftp_list'
  | 'sftp_download'
  | 'sftp_upload'
  | 'sftp_delete'
  | 'sftp_mkdir'
  | 'sftp_rename'
  | 'machine_create'
  | 'machine_update'
  | 'machine_delete'
  | 'user_create'
  | 'user_update'
  | 'user_delete';

export interface AuditLog {
  id: number;
  user_id: number;
  username: string;
  action: AuditAction;
  machine_id?: number;
  machine_name?: string;
  details?: string;
  ip_address: string;
  created_at: string;
}

export interface AuditLogResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  limit: number;
}
