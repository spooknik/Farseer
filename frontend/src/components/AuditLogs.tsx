import { useState, useEffect, useCallback } from 'react';
import type { AuditLog, AuditAction } from '../types';
import { listAuditLogs, getAuditActions } from '../services/api';

interface Props {
  onClose: () => void;
}

const actionLabels: Record<AuditAction, string> = {
  login: 'Login',
  logout: 'Logout',
  ssh_connect: 'SSH Connect',
  ssh_disconnect: 'SSH Disconnect',
  sftp_list: 'SFTP List',
  sftp_download: 'SFTP Download',
  sftp_upload: 'SFTP Upload',
  sftp_delete: 'SFTP Delete',
  sftp_mkdir: 'SFTP Mkdir',
  sftp_rename: 'SFTP Rename',
  machine_create: 'Machine Create',
  machine_update: 'Machine Update',
  machine_delete: 'Machine Delete',
  user_create: 'User Create',
  user_update: 'User Update',
  user_delete: 'User Delete',
  totp_setup: 'TOTP Setup',
};

const actionColors: Record<string, string> = {
  login: 'text-term-green',
  logout: 'text-term-fg-dim',
  ssh_connect: 'text-term-cyan',
  ssh_disconnect: 'text-term-cyan',
  sftp_list: 'text-term-blue',
  sftp_download: 'text-term-blue',
  sftp_upload: 'text-term-blue',
  sftp_delete: 'text-term-red',
  sftp_mkdir: 'text-term-blue',
  sftp_rename: 'text-term-blue',
  machine_create: 'text-term-green',
  machine_update: 'text-term-fg-dim',
  machine_delete: 'text-term-red',
  user_create: 'text-term-green',
  user_update: 'text-term-fg-dim',
  user_delete: 'text-term-red',
  totp_setup: 'text-term-green',
};

export default function AuditLogs({ onClose }: Props) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [actions, setActions] = useState<AuditAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterAction, setFilterAction] = useState<AuditAction | ''>('');
  const limit = 20;

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params: { page: number; limit: number; action?: AuditAction } = { page, limit };
      if (filterAction) {
        params.action = filterAction;
      }
      const response = await listAuditLogs(params);
      setLogs(response.logs);
      setTotal(response.total);
    } catch (err) {
      setError('Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  }, [page, filterAction]);

  const fetchActions = useCallback(async () => {
    try {
      const response = await getAuditActions();
      setActions(response);
    } catch (err) {
      // Non-critical, ignore
    }
  }, []);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="border border-term-border bg-term-surface w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-3 py-1.5 bg-term-surface-alt border-b border-term-border">
          <span className="text-xs text-term-fg-dim font-mono">--[ audit logs ]--</span>
          <button
            onClick={onClose}
            className="text-xs text-term-fg-dim hover:text-term-red font-mono"
          >
            [x]
          </button>
        </div>

        <div className="px-3 py-2 border-b border-term-border flex items-center gap-4">
          <label className="text-term-fg-dim text-xs font-mono">Filter by action:</label>
          <select
            value={filterAction}
            onChange={(e) => {
              setFilterAction(e.target.value as AuditAction | '');
              setPage(1);
            }}
            className="bg-term-black border border-term-border text-term-fg text-xs py-1.5 px-2 focus:outline-none focus:border-term-cyan font-mono"
          >
            <option value="">All actions</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {actionLabels[action] || action}
              </option>
            ))}
          </select>
          <span className="text-term-fg-dim text-xs font-mono ml-auto">
            {total} total entries
          </span>
        </div>

        <div className="flex-1 overflow-auto px-3 py-2">
          {error && (
            <div className="text-term-red text-xs font-mono border border-term-red/30 px-2 py-1.5 mb-3">
              ! {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-term-fg-dim text-xs font-mono animate-pulse">Loading audit logs..._</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center text-term-fg-dim text-xs font-mono py-12">
              -- no audit logs found --
            </div>
          ) : (
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-left bg-term-surface-alt text-term-fg-dim text-xs">
                  <th className="py-1.5 px-2">Time</th>
                  <th className="py-1.5 px-2">User</th>
                  <th className="py-1.5 px-2">Action</th>
                  <th className="py-1.5 px-2">Machine</th>
                  <th className="py-1.5 px-2">Details</th>
                  <th className="py-1.5 px-2">IP Address</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-term-border hover:bg-term-surface-alt">
                    <td className="py-1.5 px-2 text-term-fg-dim whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="py-1.5 px-2 text-term-fg">
                      {log.username || `User #${log.user_id}`}
                    </td>
                    <td className="py-1.5 px-2">
                      <span className={`text-xs ${actionColors[log.action] || 'text-term-fg-dim'}`}>
                        [{log.action}]
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-term-fg-dim">
                      {log.machine_name || '-'}
                    </td>
                    <td className="py-1.5 px-2 text-term-fg-dim max-w-xs truncate" title={log.details}>
                      {log.details || '-'}
                    </td>
                    <td className="py-1.5 px-2 text-term-fg-dim text-xs">
                      {log.ip_address || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="px-3 py-2 border-t border-term-border flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className={`text-xs font-mono ${page === 1 ? 'text-term-fg-muted cursor-not-allowed' : 'text-term-fg-dim hover:text-term-fg'}`}
            >
              [&lt; prev]
            </button>
            <span className="text-term-fg-dim text-xs font-mono">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className={`text-xs font-mono ${page === totalPages ? 'text-term-fg-muted cursor-not-allowed' : 'text-term-fg-dim hover:text-term-fg'}`}
            >
              [next &gt;]
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
