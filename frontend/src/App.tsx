import { useState, useEffect, useCallback, useMemo } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Login from './components/Login';
import MachineList from './components/MachineList';
import MachineForm from './components/MachineForm';
import SplitTerminalContainer from './components/SplitTerminalContainer';
import FileManager from './components/FileManager';
import UserManagement from './components/UserManagement';
import AuditLogs from './components/AuditLogs';
import Settings from './components/Settings';
import type { Machine, User } from './types';
import { getCurrentUser, listMachines } from './services/api';
import { useKeyboardShortcuts, formatShortcut, type KeyboardShortcut } from './hooks/useKeyboardShortcuts';

const FARSEER_LOGO = `
 ███████╗ █████╗ ██████╗ ███████╗███████╗███████╗██████╗
 ██╔════╝██╔══██╗██╔══██╗██╔════╝██╔════╝██╔════╝██╔══██╗
 █████╗  ███████║██████╔╝███████╗█████╗  █████╗  ██████╔╝
 ██╔══╝  ██╔══██║██╔══██╗╚════██║██╔══╝  ██╔══╝  ██╔══██╗
 ██║     ██║  ██║██║  ██║███████║███████╗███████╗██║  ██║
 ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝`;

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [openSessions, setOpenSessions] = useState<Machine[]>([]);
  const [showMachineForm, setShowMachineForm] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
  const [showFileManager, setShowFileManager] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [showAuditLogs, setShowAuditLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionStatuses, setSessionStatuses] = useState<Record<number, 'connecting' | 'connected' | 'disconnected' | 'error'>>({});
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [allMachines, setAllMachines] = useState<Machine[]>([]);
  const navigate = useNavigate();

  // Fetch all machines for split dropdown
  const fetchMachines = useCallback(async () => {
    try {
      const machines = await listMachines();
      setAllMachines(machines);
    } catch {
      console.error('Failed to fetch machines');
    }
  }, []);

  // Tab navigation handlers
  const handleNextTab = useCallback(() => {
    if (openSessions.length <= 1) return;
    const currentIndex = selectedMachine
      ? openSessions.findIndex((m) => m.id === selectedMachine.id)
      : -1;
    const nextIndex = (currentIndex + 1) % openSessions.length;
    setSelectedMachine(openSessions[nextIndex]);
  }, [openSessions, selectedMachine]);

  const handlePrevTab = useCallback(() => {
    if (openSessions.length <= 1) return;
    const currentIndex = selectedMachine
      ? openSessions.findIndex((m) => m.id === selectedMachine.id)
      : 0;
    const prevIndex = (currentIndex - 1 + openSessions.length) % openSessions.length;
    setSelectedMachine(openSessions[prevIndex]);
  }, [openSessions, selectedMachine]);

  const handleSessionStatusChange = useCallback((machineId: number, status: 'connecting' | 'connected' | 'disconnected' | 'error') => {
    setSessionStatuses(prev => {
      // If disconnected, remove the status entirely so the dot disappears
      if (status === 'disconnected') {
        const next = { ...prev };
        delete next[machineId];
        return next;
      }
      return { ...prev, [machineId]: status };
    });
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      setIsAuthenticated(true);
      // Fetch current user info
      getCurrentUser()
        .then(setCurrentUser)
        .catch(() => {
          // Token might be invalid
          localStorage.removeItem('token');
          localStorage.removeItem('encryptionKey');
          localStorage.removeItem('userId');
          setIsAuthenticated(false);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  // Warn user before closing tab if there are connected sessions
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Check if any session is connected
      const hasConnectedSession = Object.values(sessionStatuses).some(
        status => status === 'connected'
      );
      
      if (hasConnectedSession) {
        // Standard way to trigger the browser's confirmation dialog
        e.preventDefault();
        // For older browsers
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [sessionStatuses]);

  // Fetch machines when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchMachines();
    }
  }, [isAuthenticated, refreshKey, fetchMachines]);

  const handleLogin = () => {
    setIsAuthenticated(true);
    getCurrentUser().then(setCurrentUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('encryptionKey');
    localStorage.removeItem('userId');
    setIsAuthenticated(false);
    setCurrentUser(null);
    setSelectedMachine(null);
    setOpenSessions([]);
    navigate('/login');
  };

  const handleSelectMachine = (machine: Machine | null) => {
    if (machine) {
      // Add to open sessions if not already there
      setOpenSessions((prev) => {
        if (!prev.find((m) => m.id === machine.id)) {
          return [...prev, machine];
        }
        return prev;
      });
    }
    setSelectedMachine(machine);
  };

  const handleCloseSession = useCallback((machineId: number) => {
    setOpenSessions((prev) => prev.filter((m) => m.id !== machineId));
    setSelectedMachine((current) => {
      if (current?.id === machineId) {
        // Switch to another open session or null
        const remaining = openSessions.filter((m) => m.id !== machineId);
        return remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }
      return current;
    });
  }, [openSessions]);

  const handleAddMachine = useCallback(() => {
    setEditingMachine(null);
    setShowMachineForm(true);
  }, []);

  const handleEditMachine = (machine: Machine) => {
    setEditingMachine(machine);
    setShowMachineForm(true);
  };

  const handleSaveMachine = () => {
    setShowMachineForm(false);
    setEditingMachine(null);
    setRefreshKey((k) => k + 1);
  };

  const handleCancelMachineForm = () => {
    setShowMachineForm(false);
    setEditingMachine(null);
  };

  // Keyboard shortcuts
  const shortcuts: KeyboardShortcut[] = useMemo(() => [
    {
      key: 'T',
      ctrl: true,
      shift: true,
      action: handleAddMachine,
      description: 'New connection',
    },
    {
      key: 'W',
      ctrl: true,
      action: () => {
        if (selectedMachine) {
          handleCloseSession(selectedMachine.id);
        }
      },
      description: 'Close current tab',
    },
    {
      key: 'Tab',
      ctrl: true,
      action: handleNextTab,
      description: 'Next tab',
    },
    {
      key: 'Tab',
      ctrl: true,
      shift: true,
      action: handlePrevTab,
      description: 'Previous tab',
    },
    {
      key: '/',
      ctrl: true,
      action: () => setShowShortcutsHelp((prev) => !prev),
      description: 'Toggle shortcuts help',
    },
  ], [handleAddMachine, selectedMachine, handleCloseSession, handleNextTab, handlePrevTab]);

  // Only enable shortcuts when authenticated and no modal is open
  const shortcutsEnabled = isAuthenticated && !showMachineForm && !showFileManager && !showUserManagement && !showAuditLogs && !showSettings;
  useKeyboardShortcuts(shortcuts, { enabled: shortcutsEnabled });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-term-black">
        <span className="text-term-fg-dim text-xs">loading<span className="cursor-blink"></span></span>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isAuthenticated ? (
            <Navigate to="/" replace />
          ) : (
            <Login onLogin={handleLogin} />
          )
        }
      />
      <Route
        path="/*"
        element={
          isAuthenticated ? (
            <div className="h-screen flex flex-col bg-term-black">
              {/* Top header bar */}
              <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 bg-term-surface-alt border-b border-term-border">
                <pre
                  className="text-term-cyan leading-none select-none"
                  style={{ fontSize: '6px' }}
                >{FARSEER_LOGO}</pre>
                <div className="flex items-center gap-1">
                  {currentUser && (
                    <>
                      <span className="text-term-fg-dim text-xs mr-1">{currentUser.username}</span>
                      {currentUser.role === 'admin' && (
                        <span className="text-term-magenta text-xs mr-1">[admin]</span>
                      )}
                      <span className="text-term-fg-muted text-xs mr-1">|</span>
                    </>
                  )}
                  {currentUser?.role === 'admin' && (
                    <>
                      <button
                        onClick={() => setShowAuditLogs(true)}
                        className="px-1.5 py-0.5 text-xs text-term-fg-dim hover:text-term-fg-bright transition-colors"
                        title="Audit Logs"
                      >
                        [log]
                      </button>
                      <button
                        onClick={() => setShowUserManagement(true)}
                        className="px-1.5 py-0.5 text-xs text-term-fg-dim hover:text-term-fg-bright transition-colors"
                        title="Manage Users"
                      >
                        [usr]
                      </button>
                      <button
                        onClick={() => setShowSettings(true)}
                        className="px-1.5 py-0.5 text-xs text-term-fg-dim hover:text-term-fg-bright transition-colors"
                        title="Settings"
                      >
                        [cfg]
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setShowShortcutsHelp(true)}
                    className="px-1.5 py-0.5 text-xs text-term-fg-dim hover:text-term-fg-bright transition-colors"
                    title={`Keyboard Shortcuts (${formatShortcut({ key: '/', ctrl: true })})`}
                  >
                    [?]
                  </button>
                  <button
                    onClick={handleLogout}
                    className="px-1.5 py-0.5 text-xs text-term-fg-dim hover:text-term-red transition-colors"
                    title="Logout"
                  >
                    [out]
                  </button>
                </div>
              </div>

              {/* Body: sidebar + main content */}
              <div className="flex-1 flex overflow-hidden">
                {/* Sidebar */}
                <div className="w-72 flex-shrink-0 bg-term-surface border-r border-term-border flex flex-col">
                  <div className="flex-1 overflow-hidden" key={refreshKey}>
                    <MachineList
                      selectedMachine={selectedMachine}
                      onSelectMachine={handleSelectMachine}
                      onAddMachine={handleAddMachine}
                      onEditMachine={handleEditMachine}
                      openSessions={openSessions}
                      sessionStatuses={sessionStatuses}
                    />
                  </div>
                </div>

              {/* Main content */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Action bar */}
                {selectedMachine && (
                  <div className="flex items-center justify-between px-3 py-1 bg-term-surface-alt border-b border-term-border">
                    <span className="text-term-fg-dim text-xs">
                      session: <span className="text-term-fg">{selectedMachine.name}</span>
                    </span>
                    <button
                      onClick={() => setShowFileManager(true)}
                      className="text-xs text-term-fg-dim hover:text-term-fg transition-colors"
                    >
                      [sftp]
                    </button>
                  </div>
                )}

                {/* Session tabs — tmux style */}
                {openSessions.length > 0 && (
                  <div className="flex items-center bg-term-surface-alt border-b border-term-border px-1 overflow-x-auto">
                    <span className="text-term-fg-muted text-xs mr-1 flex-shrink-0">[</span>
                    {openSessions.map((machine, index) => {
                      const isActive = selectedMachine?.id === machine.id;
                      const status = sessionStatuses[machine.id];
                      return (
                        <div
                          key={machine.id}
                          className={`flex items-center gap-1 px-2 py-1 cursor-pointer text-xs transition-colors ${
                            isActive ? 'text-term-cyan' : 'text-term-fg-dim hover:text-term-fg'
                          }`}
                          onClick={() => setSelectedMachine(machine)}
                        >
                          <span className="text-term-fg-muted">{index}:</span>
                          <span className={`truncate max-w-24 ${isActive ? 'text-term-cyan' : ''}`}>
                            {machine.name}
                          </span>
                          {isActive && <span className="text-term-cyan">*</span>}
                          {status === 'connected' && !isActive && (
                            <span className="text-term-green text-[10px]">+</span>
                          )}
                          {status === 'error' && (
                            <span className="text-term-red text-[10px]">!</span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCloseSession(machine.id);
                            }}
                            className="text-term-fg-dim hover:text-term-red ml-0.5 transition-colors flex-shrink-0"
                            title="Close session"
                          >
                            [x]
                          </button>
                          {index < openSessions.length - 1 && (
                            <span className="text-term-fg-muted ml-1">|</span>
                          )}
                        </div>
                      );
                    })}
                    <span className="text-term-fg-muted text-xs ml-1 flex-shrink-0">]</span>
                  </div>
                )}

                {/* Terminal area - render all open sessions, show only selected */}
                <div className="flex-1 overflow-hidden relative">
                  {openSessions.map((machine) => (
                    <div
                      key={machine.id}
                      className="absolute inset-0"
                      style={{
                        visibility: selectedMachine?.id === machine.id ? 'visible' : 'hidden',
                        zIndex: selectedMachine?.id === machine.id ? 1 : 0,
                      }}
                    >
                      <SplitTerminalContainer machine={machine} availableMachines={allMachines} onStatusChange={handleSessionStatusChange} />
                    </div>
                  ))}

                  {/* Empty state */}
                  {openSessions.length === 0 && (
                    <div className="h-full flex items-center justify-center">
                      <div className="text-center">
                        <pre className="text-term-fg-muted text-xs leading-relaxed">{`  no active sessions

  select a machine from the sidebar
  or press Ctrl+Shift+T to add one`}</pre>
                        <span className="cursor-blink text-term-fg-muted"></span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              </div>

              {/* Machine form modal */}
              {showMachineForm && (
                <MachineForm
                  machine={editingMachine}
                  onSave={handleSaveMachine}
                  onCancel={handleCancelMachineForm}
                />
              )}

              {/* File manager modal */}
              {showFileManager && selectedMachine && (
                <FileManager
                  machine={selectedMachine}
                  onClose={() => setShowFileManager(false)}
                />
              )}

              {/* User management modal (admin only) */}
              {showUserManagement && currentUser && (
                <UserManagement
                  onClose={() => setShowUserManagement(false)}
                  currentUserId={currentUser.id}
                />
              )}

              {/* Audit logs modal (admin only) */}
              {showAuditLogs && (
                <AuditLogs onClose={() => setShowAuditLogs(false)} />
              )}

              {/* Settings modal (admin only) */}
              {showSettings && (
                <Settings onClose={() => setShowSettings(false)} />
              )}

              {/* Keyboard shortcuts help modal */}
              {showShortcutsHelp && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                  <div className="border border-term-border bg-term-surface w-full max-w-lg max-h-[80vh] flex flex-col">
                    {/* Title bar */}
                    <div className="flex items-center justify-between px-3 py-1.5 bg-term-surface-alt border-b border-term-border">
                      <span className="text-xs text-term-fg-dim">
                        --[ <span className="text-term-fg-bright">shortcuts</span> ]--
                      </span>
                      <button
                        onClick={() => setShowShortcutsHelp(false)}
                        className="text-xs text-term-fg-dim hover:text-term-red transition-colors"
                      >
                        [x]
                      </button>
                    </div>

                    <div className="p-4 overflow-y-auto flex-1">
                      {/* Tab Navigation */}
                      <div className="mb-4">
                        <div className="text-term-fg-dim text-xs tracking-wider uppercase mb-2">-- navigation --</div>
                        <div className="space-y-1">
                          {shortcuts.map((shortcut, index) => (
                            <div key={index} className="flex items-center justify-between py-1">
                              <span className="text-term-fg text-xs">{shortcut.description}</span>
                              <kbd className="text-term-cyan text-xs bg-term-black px-2 py-0.5 border border-term-border">
                                {formatShortcut(shortcut)}
                              </kbd>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Split Terminal */}
                      <div className="mb-4">
                        <div className="text-term-fg-dim text-xs tracking-wider uppercase mb-2">-- split terminal --</div>
                        <div className="space-y-1">
                          {[
                            { desc: 'Split pane vertically', shortcut: { key: 'D', ctrl: true, shift: true } },
                            { desc: 'Split pane horizontally', shortcut: { key: 'E', ctrl: true, shift: true } },
                            { desc: 'Close focused pane', shortcut: { key: 'X', ctrl: true, shift: true } },
                            { desc: 'Focus next pane', shortcut: { key: 'ArrowRight', ctrl: true, alt: true } },
                            { desc: 'Focus previous pane', shortcut: { key: 'ArrowLeft', ctrl: true, alt: true } },
                          ].map((item, i) => (
                            <div key={i} className="flex items-center justify-between py-1">
                              <span className="text-term-fg text-xs">{item.desc}</span>
                              <kbd className="text-term-cyan text-xs bg-term-black px-2 py-0.5 border border-term-border">
                                {formatShortcut(item.shortcut)}
                              </kbd>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="pt-3 border-t border-term-border">
                        <p className="text-xs text-term-fg-muted text-center">
                          press {formatShortcut({ key: '/', ctrl: true })} to toggle this help
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}

export default App;
