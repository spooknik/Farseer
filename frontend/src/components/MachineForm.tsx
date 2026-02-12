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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="border border-term-border bg-term-surface max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Title bar */}
        <div className="px-3 py-1.5 bg-term-surface-alt border-b border-term-border flex items-center justify-between">
          <span className="text-xs text-term-fg-dim font-mono">
            {isEditing ? '--[ edit machine ]--' : '--[ add machine ]--'}
          </span>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="text-xs text-term-fg-dim hover:text-term-red transition-colors font-mono"
          >
            [x]
          </button>
        </div>

        <div className="p-4">
          {error && (
            <div className="mb-4 text-term-red text-xs border border-term-red/30 bg-term-red-dim/30 px-3 py-2 font-mono">
              [ERR] {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-term-fg-dim text-xs mb-1 block font-mono">
                Name
              </label>
              <div className="flex items-center gap-2">
                <span className="text-term-cyan text-xs font-mono">&gt;</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="flex-1 bg-term-black border border-term-border text-term-fg-bright text-xs py-1.5 px-2 focus:outline-none focus:border-term-cyan font-mono"
                  placeholder="My Server"
                  required
                />
              </div>
            </div>

            {groups.length > 0 && (
              <div>
                <label className="text-term-fg-dim text-xs mb-1 block font-mono">
                  Group
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-term-cyan text-xs font-mono">&gt;</span>
                  <select
                    value={groupId || ''}
                    onChange={(e) => setGroupId(e.target.value ? parseInt(e.target.value) : null)}
                    className="flex-1 bg-term-black border border-term-border text-term-fg text-xs py-1.5 px-2 focus:outline-none focus:border-term-cyan font-mono"
                  >
                    <option value="">No group</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="text-term-fg-dim text-xs mb-1 block font-mono">
                  Hostname
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-term-cyan text-xs font-mono">&gt;</span>
                  <input
                    type="text"
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value)}
                    className="flex-1 bg-term-black border border-term-border text-term-fg-bright text-xs py-1.5 px-2 focus:outline-none focus:border-term-cyan font-mono"
                    placeholder="192.168.1.100"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="text-term-fg-dim text-xs mb-1 block font-mono">
                  Port
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-term-cyan text-xs font-mono">&gt;</span>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(parseInt(e.target.value) || 22)}
                    className="flex-1 bg-term-black border border-term-border text-term-fg-bright text-xs py-1.5 px-2 focus:outline-none focus:border-term-cyan font-mono"
                    min={1}
                    max={65535}
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="text-term-fg-dim text-xs mb-1 block font-mono">
                Username
              </label>
              <div className="flex items-center gap-2">
                <span className="text-term-cyan text-xs font-mono">&gt;</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="flex-1 bg-term-black border border-term-border text-term-fg-bright text-xs py-1.5 px-2 focus:outline-none focus:border-term-cyan font-mono"
                  placeholder="root"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-term-fg-dim text-xs mb-1 block font-mono">
                Authentication Type
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setAuthType('password')}
                  className={`text-xs font-mono border px-3 py-1.5 transition-colors ${
                    authType === 'password'
                      ? 'border-term-cyan text-term-cyan bg-term-cyan/10'
                      : 'border-term-border text-term-fg-dim hover:text-term-fg'
                  }`}
                >
                  [password]
                </button>
                <button
                  type="button"
                  onClick={() => setAuthType('key')}
                  className={`text-xs font-mono border px-3 py-1.5 transition-colors ${
                    authType === 'key'
                      ? 'border-term-cyan text-term-cyan bg-term-cyan/10'
                      : 'border-term-border text-term-fg-dim hover:text-term-fg'
                  }`}
                >
                  [private key]
                </button>
              </div>
            </div>

            {authType === 'password' ? (
              <div>
                <label className="text-term-fg-dim text-xs mb-1 block font-mono">
                  Password {isEditing && <span className="text-term-fg-dim">(leave empty to keep current)</span>}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-term-cyan text-xs font-mono">&gt;</span>
                  <input
                    type="password"
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    className="flex-1 bg-term-black border border-term-border text-term-fg-bright text-xs py-1.5 px-2 focus:outline-none focus:border-term-cyan font-mono"
                    placeholder="Enter password"
                    required={!isEditing}
                  />
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-term-fg-dim text-xs mb-1 block font-mono">
                    Private Key {isEditing && <span className="text-term-fg-dim">(leave empty to keep current)</span>}
                  </label>
                  <textarea
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    className="w-full bg-term-black border border-term-border text-term-fg text-xs py-2 px-2 focus:outline-none focus:border-term-cyan font-mono"
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    rows={6}
                    required={!isEditing}
                  />
                </div>
                <div>
                  <label className="text-term-fg-dim text-xs mb-1 block font-mono">
                    Passphrase (optional)
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-term-cyan text-xs font-mono">&gt;</span>
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      className="flex-1 bg-term-black border border-term-border text-term-fg-bright text-xs py-1.5 px-2 focus:outline-none focus:border-term-cyan font-mono"
                      placeholder="Enter passphrase if key is encrypted"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-term-border">
              <button
                type="button"
                onClick={onCancel}
                className="text-xs text-term-fg-dim hover:text-term-fg transition-colors font-mono px-3 py-1.5"
                disabled={loading}
              >
                [ cancel ]
              </button>
              <button
                type="submit"
                className="text-xs border border-term-cyan text-term-cyan hover:bg-term-cyan hover:text-term-black transition-colors font-mono px-3 py-1.5 disabled:opacity-50"
                disabled={loading}
              >
                {loading ? '[ saving... ]' : isEditing ? '[ save ]' : '[ add ]'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
