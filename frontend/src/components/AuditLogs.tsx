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
};

const actionColors: Record<string, string> = {
  login: 'bg-green-500/20 text-green-400',
  logout: 'bg-gray-500/20 text-gray-400',
  ssh_connect: 'bg-blue-500/20 text-blue-400',
  ssh_disconnect: 'bg-blue-500/20 text-blue-400',
  sftp_list: 'bg-purple-500/20 text-purple-400',
  sftp_download: 'bg-cyan-500/20 text-cyan-400',
  sftp_upload: 'bg-cyan-500/20 text-cyan-400',
  sftp_delete: 'bg-red-500/20 text-red-400',
  sftp_mkdir: 'bg-purple-500/20 text-purple-400',
  sftp_rename: 'bg-purple-500/20 text-purple-400',
  machine_create: 'bg-emerald-500/20 text-emerald-400',
  machine_update: 'bg-yellow-500/20 text-yellow-400',
  machine_delete: 'bg-red-500/20 text-red-400',
  user_create: 'bg-emerald-500/20 text-emerald-400',
  user_update: 'bg-yellow-500/20 text-yellow-400',
  user_delete: 'bg-red-500/20 text-red-400',
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">Audit Logs</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 border-b border-gray-700 flex items-center gap-4">
          <label className="text-sm text-gray-400">Filter by action:</label>
          <select
            value={filterAction}
            onChange={(e) => {
              setFilterAction(e.target.value as AuditAction | '');
              setPage(1);
            }}
            className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All actions</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {actionLabels[action] || action}
              </option>
            ))}
          </select>
          <span className="text-sm text-gray-400 ml-auto">
            {total} total entries
          </span>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {error && (
            <div className="bg-red-500/20 text-red-400 p-3 rounded mb-4">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              No audit logs found
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-3 pr-4">Time</th>
                  <th className="pb-3 pr-4">User</th>
                  <th className="pb-3 pr-4">Action</th>
                  <th className="pb-3 pr-4">Machine</th>
                  <th className="pb-3 pr-4">Details</th>
                  <th className="pb-3">IP Address</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-3 pr-4 text-gray-300 whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="py-3 pr-4 text-white">
                      {log.username || `User #${log.user_id}`}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${actionColors[log.action] || 'bg-gray-500/20 text-gray-400'}`}>
                        {actionLabels[log.action] || log.action}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-gray-300">
                      {log.machine_name || '-'}
                    </td>
                    <td className="py-3 pr-4 text-gray-400 max-w-xs truncate" title={log.details}>
                      {log.details || '-'}
                    </td>
                    <td className="py-3 text-gray-400 font-mono text-xs">
                      {log.ip_address || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="p-4 border-t border-gray-700 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 bg-gray-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600 transition-colors"
            >
              Previous
            </button>
            <span className="text-gray-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-2 bg-gray-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
