import { useState, useEffect, useCallback } from 'react';
import { listUsers, createUser, updateUser, deleteUser } from '../services/api';
import type { User, UserInput, Role } from '../types';

interface UserManagementProps {
  onClose: () => void;
  currentUserId: number;
}

export default function UserManagement({ onClose, currentUserId }: UserManagementProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<UserInput>({
    username: '',
    password: '',
    role: 'user',
  });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listUsers();
      setUsers(data);
      setError('');
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showForm) {
          setShowForm(false);
          setEditingUser(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showForm, onClose]);

  const handleAdd = () => {
    setEditingUser(null);
    setFormData({ username: '', password: '', role: 'user' });
    setFormError('');
    setShowForm(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({ username: user.username, password: '', role: user.role });
    setFormError('');
    setShowForm(true);
  };

  const handleDelete = async (user: User) => {
    if (user.id === currentUserId) {
      alert('Cannot delete your own account');
      return;
    }
    if (!confirm(`Delete user "${user.username}"? This will also delete all their machines.`)) {
      return;
    }
    try {
      await deleteUser(user.id);
      fetchUsers();
    } catch {
      alert('Failed to delete user');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);

    try {
      if (editingUser) {
        const updates: Partial<UserInput> = {};
        if (formData.username !== editingUser.username) {
          updates.username = formData.username;
        }
        if (formData.password) {
          updates.password = formData.password;
        }
        if (formData.role !== editingUser.role) {
          updates.role = formData.role;
        }
        await updateUser(editingUser.id, updates);
      } else {
        await createUser(formData);
      }
      setShowForm(false);
      setEditingUser(null);
      fetchUsers();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setFormError(error.response?.data?.error || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="border border-term-border bg-term-surface w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Title bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-term-surface-alt border-b border-term-border">
          <span className="text-term-fg-dim text-xs font-mono">--[ user management ]--</span>
          <button
            onClick={onClose}
            className="text-xs text-term-fg-dim hover:text-term-red font-mono"
          >
            [x]
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-term-border">
          <span className="text-term-fg-dim text-xs">{users.length} users</span>
          <button
            onClick={handleAdd}
            className="px-2 py-0.5 text-xs border border-term-cyan text-term-cyan hover:bg-term-cyan hover:text-term-black font-mono"
          >
            [ + add user ]
          </button>
        </div>

        {/* User list */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-term-fg-dim text-xs">
              Loading...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-32 text-term-red text-xs">
              [ERR] {error}
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-term-surface-alt sticky top-0">
                <tr>
                  <th className="px-3 py-1.5 text-left text-xs text-term-fg-dim font-normal">Username</th>
                  <th className="px-3 py-1.5 text-left text-xs text-term-fg-dim font-normal w-24">Role</th>
                  <th className="px-3 py-1.5 text-left text-xs text-term-fg-dim font-normal w-20">2FA</th>
                  <th className="px-3 py-1.5 text-left text-xs text-term-fg-dim font-normal w-36">Created</th>
                  <th className="px-3 py-1.5 w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-term-border">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-term-surface-alt">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-term-fg-bright text-xs">{user.username}</span>
                        {user.id === currentUserId && (
                          <span className="text-xs text-term-cyan">
                            (you)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-mono ${
                        user.role === 'admin'
                          ? 'text-term-magenta'
                          : 'text-term-fg-dim'
                      }`}>
                        {user.role === 'admin' ? '[admin]' : '[user]'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-mono ${
                        user.totp_enabled ? 'text-term-green' : 'text-term-yellow'
                      }`}>
                        {user.totp_enabled ? '[2fa]' : '[no 2fa]'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-term-fg-dim text-xs">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(user)}
                          className="text-xs text-term-fg-dim hover:text-term-cyan font-mono"
                          title="Edit"
                        >
                          [edit]
                        </button>
                        {user.id !== currentUserId && (
                          <button
                            onClick={() => handleDelete(user)}
                            className="text-xs text-term-fg-dim hover:text-term-red font-mono"
                            title="Delete"
                          >
                            [del]
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Add/Edit Form Modal */}
        {showForm && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <div className="border border-term-border bg-term-surface w-96">
              <div className="px-3 py-1.5 bg-term-surface-alt border-b border-term-border flex items-center justify-between">
                <span className="text-term-fg-dim text-xs font-mono">
                  --[ {editingUser ? 'edit user' : 'add user'} ]--
                </span>
              </div>

              <div className="p-4">
                {formError && (
                  <div className="mb-4 p-2 border border-term-red text-term-red text-xs">
                    [ERR] {formError}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-term-fg-dim text-xs mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      className="w-full bg-term-black border border-term-border text-term-fg-bright text-xs py-1.5 px-2 focus:outline-none focus:border-term-cyan"
                      required
                      minLength={3}
                    />
                  </div>

                  <div>
                    <label className="block text-term-fg-dim text-xs mb-1">
                      Password {editingUser && <span className="text-term-fg-dim">(leave empty to keep current)</span>}
                    </label>
                    <input
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full bg-term-black border border-term-border text-term-fg-bright text-xs py-1.5 px-2 focus:outline-none focus:border-term-cyan"
                      required={!editingUser}
                      minLength={8}
                    />
                  </div>

                  <div>
                    <label className="block text-term-fg-dim text-xs mb-1">
                      Role
                    </label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value as Role })}
                      className="w-full bg-term-black border border-term-border text-term-fg-bright text-xs py-1.5 px-2 focus:outline-none focus:border-term-cyan"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false);
                        setEditingUser(null);
                      }}
                      className="text-term-fg-dim hover:text-term-fg text-xs font-mono"
                      disabled={saving}
                    >
                      [ cancel ]
                    </button>
                    <button
                      type="submit"
                      className="border border-term-cyan text-term-cyan hover:bg-term-cyan hover:text-term-black text-xs font-mono px-2 py-0.5 disabled:opacity-50"
                      disabled={saving}
                    >
                      {saving ? '[ saving... ]' : editingUser ? '[ update ]' : '[ create ]'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
