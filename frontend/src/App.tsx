import { useState, useEffect, useCallback, useMemo } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Login from './components/Login';
import MachineList from './components/MachineList';
import MachineForm from './components/MachineForm';
import SplitTerminalContainer from './components/SplitTerminalContainer';
import FileManager from './components/FileManager';
import UserManagement from './components/UserManagement';
import AuditLogs from './components/AuditLogs';
import type { Machine, User } from './types';
import { getCurrentUser, listMachines } from './services/api';
import { useKeyboardShortcuts, formatShortcut, type KeyboardShortcut } from './hooks/useKeyboardShortcuts';

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
  const shortcutsEnabled = isAuthenticated && !showMachineForm && !showFileManager && !showUserManagement && !showAuditLogs;
  useKeyboardShortcuts(shortcuts, { enabled: shortcutsEnabled });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-slate-400">Loading...</div>
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
            <div className="h-screen flex bg-slate-900">
              {/* Sidebar */}
              <div className="w-72 flex-shrink-0 bg-slate-800 border-r border-slate-700 flex flex-col">
                <div className="p-4 border-b border-slate-700">
                  <div className="flex items-center justify-between">
                    <h1 className="text-xl font-bold text-white">Farseer</h1>
                    <div className="flex items-center gap-2">
                      {currentUser?.role === 'admin' && (
                        <>
                          <button
                            onClick={() => setShowAuditLogs(true)}
                            className="text-slate-400 hover:text-white transition-colors"
                            title="Audit Logs"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setShowUserManagement(true)}
                            className="text-slate-400 hover:text-white transition-colors"
                            title="Manage Users"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                            </svg>
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => setShowShortcutsHelp(true)}
                        className="text-slate-400 hover:text-white transition-colors"
                        title={`Keyboard Shortcuts (${formatShortcut({ key: '/', ctrl: true })})`}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9h.01M8 12h.01M8 15h.01M12 9h.01M12 12h.01M12 15h.01M16 9h.01M16 12h.01M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </button>
                      <button
                        onClick={handleLogout}
                        className="text-slate-400 hover:text-white transition-colors"
                        title="Logout"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {currentUser && (
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <span className="text-slate-400">{currentUser.username}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        currentUser.role === 'admin'
                          ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-slate-500/20 text-slate-400'
                      }`}>
                        {currentUser.role}
                      </span>
                    </div>
                  )}
                </div>
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
                  <div className="flex items-center justify-end gap-2 px-4 py-2 bg-slate-800/50 border-b border-slate-700">
                    <button
                      onClick={() => setShowFileManager(true)}
                      className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      Files
                    </button>
                  </div>
                )}

                {/* Session tabs */}
                {openSessions.length > 0 && (
                  <div className="flex items-center bg-slate-800 border-b border-slate-700 overflow-x-auto">
                    {openSessions.map((machine, index) => {
                      return (
                        <div
                          key={machine.id}
                          className={`flex items-center gap-2 px-4 py-2 cursor-pointer border-r border-slate-700 min-w-0 ${
                            selectedMachine?.id === machine.id
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                          }`}
                          onClick={() => setSelectedMachine(machine)}
                        >
                          <span className="truncate max-w-32">Tab {index + 1}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCloseSession(machine.id);
                            }}
                            className="p-0.5 hover:bg-slate-600 rounded flex-shrink-0"
                            title="Close session"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
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
                    <div className="h-full flex items-center justify-center text-slate-400">
                      <div className="text-center">
                        <svg className="w-16 h-16 mx-auto mb-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <p>Select a machine to connect</p>
                      </div>
                    </div>
                  )}
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

              {/* Keyboard shortcuts help modal */}
              {showShortcutsHelp && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold text-white">Keyboard Shortcuts</h2>
                      <button
                        onClick={() => setShowShortcutsHelp(false)}
                        className="text-slate-400 hover:text-white transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    
                    {/* Tab Navigation */}
                    <div className="mb-4">
                      <h3 className="text-sm font-medium text-slate-400 mb-2">Tab Navigation</h3>
                      <div className="space-y-2">
                        {shortcuts.map((shortcut, index) => (
                          <div key={index} className="flex items-center justify-between">
                            <span className="text-slate-300 text-sm">{shortcut.description}</span>
                            <kbd className="px-2 py-1 bg-slate-700 rounded text-xs font-mono text-slate-200">
                              {formatShortcut(shortcut)}
                            </kbd>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* Split Terminal */}
                    <div className="mb-4">
                      <h3 className="text-sm font-medium text-slate-400 mb-2">Split Terminal</h3>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-300 text-sm">Split pane vertically</span>
                          <kbd className="px-2 py-1 bg-slate-700 rounded text-xs font-mono text-slate-200">
                            {formatShortcut({ key: 'D', ctrl: true, shift: true })}
                          </kbd>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-300 text-sm">Split pane horizontally</span>
                          <kbd className="px-2 py-1 bg-slate-700 rounded text-xs font-mono text-slate-200">
                            {formatShortcut({ key: 'E', ctrl: true, shift: true })}
                          </kbd>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-300 text-sm">Close focused pane</span>
                          <kbd className="px-2 py-1 bg-slate-700 rounded text-xs font-mono text-slate-200">
                            {formatShortcut({ key: 'X', ctrl: true, shift: true })}
                          </kbd>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-300 text-sm">Focus next pane</span>
                          <kbd className="px-2 py-1 bg-slate-700 rounded text-xs font-mono text-slate-200">
                            {formatShortcut({ key: 'ArrowRight', ctrl: true, alt: true })}
                          </kbd>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-300 text-sm">Focus previous pane</span>
                          <kbd className="px-2 py-1 bg-slate-700 rounded text-xs font-mono text-slate-200">
                            {formatShortcut({ key: 'ArrowLeft', ctrl: true, alt: true })}
                          </kbd>
                        </div>
                      </div>
                    </div>
                    
                    <div className="pt-4 border-t border-slate-700">
                      <p className="text-xs text-slate-500 text-center">
                        Press {formatShortcut({ key: '/', ctrl: true })} to toggle this help
                      </p>
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
