import { useState, FormEvent, useEffect, useCallback } from 'react';
import { createMachine, updateMachine, listGroups } from '../services/api';
import type { Machine, MachineInput, Group } from '../types';

interface MachineFormProps {
  machine?: Machine | null;
  onSave: () => void;
  onCancel: () => void;
}

export default function MachineForm({ machine, onSave, onCancel }: MachineFormProps) {
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<'password' | 'key'>('password');
  const [credential, setCredential] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);

  const isEditing = !!machine;

  // Fetch groups on mount
  useEffect(() => {
    listGroups().then(setGroups).catch(() => {});
  }, []);

  // Handle Escape key to close modal
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && !loading) {
      onCancel();
    }
  }, [loading, onCancel]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (machine) {
      setName(machine.name);
      setGroupId(machine.group_id || null);
      setHostname(machine.hostname);
      setPort(machine.port);
      setUsername(machine.username);
      setAuthType(machine.auth_type);
      setCredential('');
      setPassphrase('');
    }
  }, [machine]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const input: MachineInput = {
        name,
        group_id: groupId,
        hostname,
        port,
        username,
        auth_type: authType,
        credential,
        passphrase: authType === 'key' ? passphrase : undefined,
      };

      if (isEditing) {
        await updateMachine(machine.id, input);
      } else {
        await createMachine(input);
      }

      onSave();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Failed to save machine');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-800 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-semibold text-white mb-4">
            {isEditing ? 'Edit Machine' : 'Add Machine'}
          </h2>

          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="My Server"
                required
              />
            </div>

            {groups.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Group
                </label>
                <select
                  value={groupId || ''}
                  onChange={(e) => setGroupId(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">No group</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Hostname
                </label>
                <input
                  type="text"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="192.168.1.100"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Port
                </label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value) || 22)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min={1}
                  max={65535}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="root"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Authentication Type
              </label>
              <div className="flex gap-4">
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="password"
                    checked={authType === 'password'}
                    onChange={() => setAuthType('password')}
                    className="mr-2"
                  />
                  <span className="text-white">Password</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="key"
                    checked={authType === 'key'}
                    onChange={() => setAuthType('key')}
                    className="mr-2"
                  />
                  <span className="text-white">Private Key</span>
                </label>
              </div>
            </div>

            {authType === 'password' ? (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Password {isEditing && <span className="text-slate-500">(leave empty to keep current)</span>}
                </label>
                <input
                  type="password"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter password"
                  required={!isEditing}
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Private Key {isEditing && <span className="text-slate-500">(leave empty to keep current)</span>}
                  </label>
                  <textarea
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    rows={6}
                    required={!isEditing}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Passphrase (optional)
                  </label>
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter passphrase if key is encrypted"
                  />
                </div>
              </>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:opacity-50"
                disabled={loading}
              >
                {loading ? 'Saving...' : isEditing ? 'Update' : 'Add Machine'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
