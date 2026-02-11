import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import type { Machine, WSMessage } from '../types';
import { getSSHWebSocketUrl } from '../services/api';

export interface TerminalPaneProps {
  machine: Machine;
  paneId: string;
  isFocused: boolean;
  showHeader?: boolean;
  availableMachines?: Machine[];
  onFocus: () => void;
  onClose?: () => void;
  onSplitHorizontal?: (targetMachine: Machine) => void;
  onSplitVertical?: (targetMachine: Machine) => void;
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
}

interface HostKeyVerifyData {
  status: 'new' | 'mismatch';
  fingerprint: string;
  stored_key?: string;
}

type SplitDirection = 'horizontal' | 'vertical';

export default function TerminalPane({
  machine,
  paneId,
  isFocused,
  showHeader = true,
  availableMachines = [],
  onFocus,
  onClose,
  onSplitHorizontal,
  onSplitVertical,
  onStatusChange,
}: TerminalPaneProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyVerifyData | null>(null);
  const [splitDropdown, setSplitDropdown] = useState<SplitDirection | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Notify parent of status changes
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  const handleHostKeyResponse = useCallback((accept: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'host_key_confirm',
        data: { accept },
      }));
    }
    setHostKeyPrompt(null);
    if (!accept) {
      setStatus('error');
    }
  }, []);

  const connect = useCallback(() => {
    if (!terminalRef.current) return;

    // Clean up existing
    if (cleanupRef.current) {
      cleanupRef.current();
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }

    setStatus('connecting');

    // Create new terminal
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      allowProposedApi: true,
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#e2e8f0',
        cursorAccent: '#0f172a',
        selectionBackground: 'rgba(59, 130, 246, 0.3)',
        black: '#1e293b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e2e8f0',
        brightBlack: '#475569',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#f8fafc',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    // Open terminal
    term.open(terminalRef.current);

    // Delay fit to ensure DOM is ready
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch (e) {
        console.warn('Initial fit failed:', e);
      }
    }, 100);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln('Connecting to ' + machine.hostname + '...');

    // Connect WebSocket
    const userId = localStorage.getItem('userId');
    const encryptionKey = localStorage.getItem('encryptionKey');
    if (!userId || !encryptionKey) {
      setStatus('error');
      term.writeln('\r\n\x1b[31mError: Authentication required\x1b[0m');
      return;
    }

    const wsUrl = getSSHWebSocketUrl(machine.id, parseInt(userId));
    console.log(`[Pane ${paneId}] Connecting to WebSocket:`, wsUrl.replace(/token=[^&]+/, 'token=***'));

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`[Pane ${paneId}] WebSocket connected, waiting for ready signal`);
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);

        switch (msg.type) {
          case 'ready':
            // Server is ready, send encryption key via secure WebSocket channel
            console.log(`[Pane ${paneId}] Sending auth credentials`);
            ws.send(JSON.stringify({
              type: 'auth',
              data: { key: encryptionKey },
            }));
            break;

          case 'connected':
            setStatus('connected');
            term.clear();
            // Send initial resize after connection
            setTimeout(() => {
              try {
                const dims = fitAddon.proposeDimensions();
                if (dims && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    type: 'resize',
                    data: { rows: dims.rows, cols: dims.cols },
                  }));
                }
              } catch (e) {
                console.warn('Failed to send initial resize:', e);
              }
            }, 100);
            break;

          case 'host_key_verify': {
            const hostKeyData = msg.data as HostKeyVerifyData;
            setHostKeyPrompt(hostKeyData);
            break;
          }

          case 'output': {
            const output = msg.data as { data: string };
            term.write(output.data);
            break;
          }

          case 'error': {
            const error = msg.data as { error: string };
            setStatus('error');
            term.writeln('\r\n\x1b[31mError: ' + error.error + '\x1b[0m');
            break;
          }

          case 'pong':
            // Keep-alive response
            break;
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    ws.onclose = (event) => {
      console.log(`[Pane ${paneId}] WebSocket closed:`, event.code, event.reason);
      setStatus((prev) => prev === 'error' ? 'error' : 'disconnected');
      if (term && event.code !== 1000) {
        term.writeln('\r\n\x1b[33mConnection closed\x1b[0m');
      }
    };

    ws.onerror = (event) => {
      console.error(`[Pane ${paneId}] WebSocket error:`, event);
      setStatus('error');
    };

    // Handle terminal input
    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'input',
          data: { data },
        }));
      }
    });

    // Handle resize
    const handleResize = () => {
      try {
        if (fitAddonRef.current && xtermRef.current) {
          fitAddonRef.current.fit();
          const dims = fitAddonRef.current.proposeDimensions();
          if (dims && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'resize',
              data: { rows: dims.rows, cols: dims.cols },
            }));
          }
        }
      } catch (e) {
        console.warn('Resize failed:', e);
      }
    };

    window.addEventListener('resize', handleResize);

    // Keep-alive ping
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    // Store cleanup function
    cleanupRef.current = () => {
      window.removeEventListener('resize', handleResize);
      clearInterval(pingInterval);
      dataDisposable.dispose();
    };
  }, [machine.id, machine.hostname, paneId]);

  // Store connect function in a ref so we can call it without adding it as a dependency
  const connectRef = useRef(connect);
  connectRef.current = connect;

  // Initialize on mount - only re-run if machine.id or paneId actually changes
  // Using refs for connect to avoid re-triggering when parent re-renders
  useEffect(() => {
    // Small delay to ensure container is rendered
    const initTimeout = setTimeout(() => {
      connectRef.current();
    }, 50);

    return () => {
      clearTimeout(initTimeout);
      if (cleanupRef.current) {
        cleanupRef.current();
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine.id, paneId]);

  // Fit terminal when container size changes
  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      // Debounce resize
      setTimeout(() => {
        try {
          if (fitAddonRef.current && xtermRef.current) {
            fitAddonRef.current.fit();
            // Also send resize to server
            const dims = fitAddonRef.current.proposeDimensions();
            if (dims && wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'resize',
                data: { rows: dims.rows, cols: dims.cols },
              }));
            }
          }
        } catch (e) {
          console.warn('ResizeObserver fit failed:', e);
        }
      }, 50);
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Focus terminal when pane becomes focused
  useEffect(() => {
    if (isFocused && xtermRef.current) {
      xtermRef.current.focus();
    }
  }, [isFocused]);

  const handleReconnect = () => {
    connect();
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setSplitDropdown(null);
      }
    };

    if (splitDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [splitDropdown]);

  const handleSplitClick = (direction: SplitDirection, e: React.MouseEvent) => {
    e.stopPropagation();
    setSplitDropdown(splitDropdown === direction ? null : direction);
  };

  const handleSelectMachine = (targetMachine: Machine, direction: SplitDirection) => {
    setSplitDropdown(null);
    if (direction === 'horizontal') {
      onSplitHorizontal?.(targetMachine);
    } else {
      onSplitVertical?.(targetMachine);
    }
  };

  const canSplit = onSplitHorizontal || onSplitVertical;
  const canClose = onClose !== undefined;

  return (
    <div
      className={`h-full flex flex-col bg-slate-900 ${isFocused ? 'ring-2 ring-blue-500 ring-inset' : ''}`}
      onClick={onFocus}
    >
      {/* Header */}
      {showHeader && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 border-b border-slate-700">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
              status === 'connected' ? 'bg-green-500' :
              status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
              status === 'error' ? 'bg-red-500' :
              'bg-slate-500'
            }`} />
            <span className="text-slate-300 text-sm truncate">
              {machine.name} - {machine.username}@{machine.hostname}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {(status === 'disconnected' || status === 'error') && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleReconnect();
                }}
                className="p-1 text-slate-400 hover:text-white transition-colors"
                title="Reconnect"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}
            {canSplit && (
              <div className="relative" ref={dropdownRef}>
                <div className="flex items-center gap-1">
                  {onSplitVertical && (
                    <button
                      onClick={(e) => handleSplitClick('vertical', e)}
                      className={`p-1 transition-colors ${splitDropdown === 'vertical' ? 'text-white bg-slate-600 rounded' : 'text-slate-400 hover:text-white'}`}
                      title="Split Vertical"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m-8-8h16" />
                      </svg>
                    </button>
                  )}
                  {onSplitHorizontal && (
                    <button
                      onClick={(e) => handleSplitClick('horizontal', e)}
                      className={`p-1 transition-colors ${splitDropdown === 'horizontal' ? 'text-white bg-slate-600 rounded' : 'text-slate-400 hover:text-white'}`}
                      title="Split Horizontal"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16" />
                      </svg>
                    </button>
                  )}
                </div>
                
                {/* Machine selection dropdown */}
                {splitDropdown && (
                  <div className="absolute right-0 top-full mt-1 w-56 bg-slate-700 border border-slate-600 rounded-md shadow-lg z-50 py-1 max-h-64 overflow-y-auto">
                    <button
                      onClick={() => handleSelectMachine(machine, splitDropdown)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-600 transition-colors flex items-center gap-2"
                    >
                      <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                      <span className="text-white font-medium">Same machine</span>
                      <span className="text-slate-400 text-xs truncate ml-auto">{machine.name}</span>
                    </button>
                    {availableMachines.length > 0 && (
                      <>
                        <div className="border-t border-slate-600 my-1" />
                        {availableMachines
                          .filter(m => m.id !== machine.id)
                          .map((m) => (
                            <button
                              key={m.id}
                              onClick={() => handleSelectMachine(m, splitDropdown)}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-600 transition-colors"
                            >
                              <div className="text-white truncate">{m.name}</div>
                              <div className="text-slate-400 text-xs truncate">{m.username}@{m.hostname}</div>
                            </button>
                          ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {canClose && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose?.();
                }}
                className="p-1 text-slate-400 hover:text-red-400 transition-colors"
                title="Close Pane"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Terminal */}
      <div ref={terminalRef} className="flex-1 overflow-hidden" />

      {/* Host Key Verification Modal */}
      {hostKeyPrompt && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-lg max-w-lg w-full p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              {hostKeyPrompt.status === 'new' ? (
                <div className="p-2 bg-yellow-500/20 rounded-full">
                  <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
              ) : (
                <div className="p-2 bg-red-500/20 rounded-full">
                  <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
              )}
              <h3 className="text-lg font-semibold text-white">
                {hostKeyPrompt.status === 'new' ? 'New Host Key' : 'Host Key Changed!'}
              </h3>
            </div>

            {hostKeyPrompt.status === 'new' ? (
              <p className="text-slate-300 mb-4">
                This is the first time connecting to <span className="font-mono text-white">{machine.hostname}</span>.
                Please verify the host key fingerprint matches what you expect.
              </p>
            ) : (
              <div className="mb-4">
                <p className="text-red-400 font-medium mb-2">
                  Warning: The host key for this server has changed!
                </p>
                <p className="text-slate-300 text-sm">
                  This could indicate a man-in-the-middle attack, or the server may have been reinstalled.
                  Only proceed if you trust this change.
                </p>
              </div>
            )}

            <div className="bg-slate-900 rounded p-3 mb-4">
              <div className="text-xs text-slate-500 mb-1">Server Fingerprint (SHA256)</div>
              <div className="font-mono text-sm text-green-400 break-all">
                {hostKeyPrompt.fingerprint}
              </div>
              {hostKeyPrompt.status === 'mismatch' && hostKeyPrompt.stored_key && (
                <>
                  <div className="text-xs text-slate-500 mt-3 mb-1">Previously Stored Fingerprint</div>
                  <div className="font-mono text-sm text-red-400 break-all">
                    {hostKeyPrompt.stored_key}
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => handleHostKeyResponse(false)}
                className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
              >
                Reject
              </button>
              <button
                onClick={() => handleHostKeyResponse(true)}
                className={`px-4 py-2 rounded font-medium transition-colors ${
                  hostKeyPrompt.status === 'new'
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {hostKeyPrompt.status === 'new' ? 'Accept & Connect' : 'Accept Anyway'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
