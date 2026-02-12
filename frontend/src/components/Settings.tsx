import { useState, useEffect } from 'react';
import { getSettings, updateSettings } from '../services/api';
import type { AppSettings } from '../types';

interface SettingsProps {
  onClose: () => void;
}

const PRESET_DURATIONS = [
  { label: '1h', value: 1 },
  { label: '4h', value: 4 },
  { label: '8h', value: 8 },
  { label: '12h', value: 12 },
  { label: '24h', value: 24 },
  { label: '48h', value: 48 },
  { label: '1 week', value: 168 },
  { label: '30 days', value: 720 },
];

export default function Settings({ onClose }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sessionHours, setSessionHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    getSettings()
      .then((data) => {
        setSettings(data);
        setSessionHours(data.session_duration_hours);
      })
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSave = async () => {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const updated = await updateSettings({ session_duration_hours: sessionHours });
      setSettings(updated);
      setSuccess('Settings saved');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = settings !== null && sessionHours !== settings.session_duration_hours;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="border border-term-border bg-term-surface w-full max-w-md">
        {/* Title bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-term-surface-alt border-b border-term-border">
          <span className="text-term-fg-dim text-xs font-mono">--[ settings ]--</span>
          <button
            onClick={onClose}
            className="text-xs text-term-fg-dim hover:text-term-red font-mono"
          >
            [x]
          </button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center h-24 text-term-fg-dim text-xs">
              Loading...
            </div>
          ) : (
            <div className="space-y-4">
              {error && (
                <div className="p-2 border border-term-red text-term-red text-xs">
                  [ERR] {error}
                </div>
              )}
              {success && (
                <div className="p-2 border border-term-green text-term-green text-xs">
                  [OK] {success}
                </div>
              )}

              {/* Session Duration */}
              <div>
                <label className="block text-term-fg-dim text-xs mb-2">
                  Session Duration
                </label>
                <p className="text-term-fg-muted text-xs mb-3">
                  How long users stay logged in before re-authentication is required.
                </p>

                {/* Preset buttons */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {PRESET_DURATIONS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setSessionHours(preset.value)}
                      className={`px-2 py-0.5 text-xs font-mono border transition-colors ${
                        sessionHours === preset.value
                          ? 'border-term-cyan text-term-cyan bg-term-cyan/10'
                          : 'border-term-border text-term-fg-dim hover:text-term-fg-bright hover:border-term-fg-dim'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Custom input */}
                <div className="flex items-center gap-2">
                  <span className="text-term-cyan text-xs">&gt;</span>
                  <span className="text-term-fg-dim text-xs">custom:</span>
                  <input
                    type="number"
                    min={1}
                    max={720}
                    value={sessionHours}
                    onChange={(e) => setSessionHours(Math.max(1, Math.min(720, parseInt(e.target.value) || 1)))}
                    className="w-20 bg-term-black border border-term-border text-term-fg-bright text-xs py-1 px-2 focus:outline-none focus:border-term-cyan text-center"
                  />
                  <span className="text-term-fg-dim text-xs">hours</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-term-border">
                <button
                  type="button"
                  onClick={onClose}
                  className="text-term-fg-dim hover:text-term-fg text-xs font-mono"
                >
                  [ cancel ]
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                  className="border border-term-cyan text-term-cyan hover:bg-term-cyan hover:text-term-black text-xs font-mono px-2 py-0.5 disabled:opacity-50"
                >
                  {saving ? '[ saving... ]' : '[ save ]'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
