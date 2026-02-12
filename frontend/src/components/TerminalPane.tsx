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
      fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", "SF Mono", Menlo, Monaco, "Courier New", monospace',
      allowProposedApi: true,
      theme: {
        background: '#0a0e14',
        foreground: '#b0bec5',
        cursor: '#56d4c8',
        cursorAccent: '#0a0e14',
        selectionBackground: 'rgba(86, 212, 200, 0.2)',
        black: '#0a0e14',
        red: '#ff5c57',
        green: '#5af78e',
        yellow: '#f3f99d',
        blue: '#57c7ff',
        magenta: '#ff6ac1',
        cyan: '#56d4c8',
        white: '#b0bec5',
        brightBlack: '#5c6a77',
        brightRed: '#ff8a84',
        brightGreen: '#83f9b2',
        brightYellow: '#f8fcc4',
        brightBlue: '#83d6ff',
        brightMagenta: '#ff94d8',
        brightCyan: '#7edfda',
        brightWhite: '#e0e6ed',
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
      className={`h-full flex flex-col bg-term-black ${isFocused ? 'border-l-2 border-l-term-cyan' : ''}`}
      onClick={onFocus}
    >
      {/* Header */}
      {showHeader && (
        <div className={`flex items-center justify-between px-3 py-1 bg-term-surface-alt border-b ${isFocused ? 'border-term-cyan' : 'border-term-border'}`}>
          <div className="flex items-center gap-2 text-xs min-w-0">
            <span className={`flex-shrink-0 ${
              status === 'connected' ? 'text-term-green' :
              status === 'connecting' ? 'text-term-yellow animate-pulse' :
              status === 'error' ? 'text-term-red' :
              'text-term-fg-dim'
            }`}>
              {status === 'connected' ? '*' :
               status === 'connecting' ? '~' :
               status === 'error' ? '!' : '-'}
            </span>
            <span className={isFocused ? 'text-term-fg-bright' : 'text-term-fg-dim'}>
              {machine.username}@{machine.hostname}
            </span>
            <span className="text-term-fg-muted">::</span>
            <span className="text-term-fg truncate">{machine.name}</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {(status === 'disconnected' || status === 'error') && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleReconnect();
                }}
                className="text-xs text-term-fg-dim hover:text-term-cyan transition-colors"
                title="Reconnect"
              >
                [retry]
              </button>
            )}
            {canSplit && (
              <div className="relative" ref={dropdownRef}>
                <div className="flex items-center gap-1">
                  {onSplitVertical && (
                    <button
                      onClick={(e) => handleSplitClick('vertical', e)}
                      className={`text-xs transition-colors ${splitDropdown === 'vertical' ? 'text-term-cyan' : 'text-term-fg-dim hover:text-term-fg'}`}
                      title="Split Vertical"
                    >
                      [|]
                    </button>
                  )}
                  {onSplitHorizontal && (
                    <button
                      onClick={(e) => handleSplitClick('horizontal', e)}
                      className={`text-xs transition-colors ${splitDropdown === 'horizontal' ? 'text-term-cyan' : 'text-term-fg-dim hover:text-term-fg'}`}
                      title="Split Horizontal"
                    >
                      [-]
                    </button>
                  )}
                </div>

                {/* Machine selection dropdown */}
                {splitDropdown && (
                  <div className="absolute right-0 top-full mt-1 w-56 bg-term-surface border border-term-border z-50 py-1 max-h-64 overflow-y-auto">
                    <button
                      onClick={() => handleSelectMachine(machine, splitDropdown)}
                      className="w-full px-3 py-1.5 text-left text-xs hover:bg-term-surface-alt transition-colors flex items-center gap-2"
                    >
                      <span className="text-term-cyan flex-shrink-0">*</span>
                      <span className="text-term-fg-bright">same machine</span>
                      <span className="text-term-fg-dim truncate ml-auto">{machine.name}</span>
                    </button>
                    {availableMachines.length > 0 && (
                      <>
                        <div className="border-t border-term-border my-1" />
                        {availableMachines
                          .filter(m => m.id !== machine.id)
                          .map((m) => (
                            <button
                              key={m.id}
                              onClick={() => handleSelectMachine(m, splitDropdown)}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-term-surface-alt transition-colors"
                            >
                              <div className="text-term-fg truncate">{m.name}</div>
                              <div className="text-term-fg-dim truncate">{m.username}@{m.hostname}</div>
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
                className="text-xs text-term-fg-dim hover:text-term-red transition-colors"
                title="Close Pane"
              >
                [x]
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
          <div className="border border-term-border bg-term-surface max-w-lg w-full flex flex-col">
            <div className="flex items-center justify-between px-3 py-1.5 bg-term-surface-alt border-b border-term-border">
              <span className="text-xs text-term-fg-dim">
                --[ <span className={hostKeyPrompt.status === 'new' ? 'text-term-yellow' : 'text-term-red'}>
                  {hostKeyPrompt.status === 'new' ? 'new host key' : 'host key changed'}
                </span> ]--
              </span>
            </div>

            <div className="p-4">
              {hostKeyPrompt.status === 'new' ? (
                <p className="text-term-fg text-xs mb-4">
                  First connection to <span className="text-term-fg-bright">{machine.hostname}</span>.
                  Verify the fingerprint matches what you expect.
                </p>
              ) : (
                <div className="mb-4">
                  <p className="text-term-red text-xs mb-2">
                    [WARN] The host key for this server has changed!
                  </p>
                  <p className="text-term-fg-dim text-xs">
                    This could indicate a MITM attack or server reinstallation.
                  </p>
                </div>
              )}

              <div className="bg-term-black border border-term-border p-3 mb-4">
                <div className="text-xs text-term-fg-dim mb-1">fingerprint (SHA256)</div>
                <div className="text-xs text-term-green break-all">
                  {hostKeyPrompt.fingerprint}
                </div>
                {hostKeyPrompt.status === 'mismatch' && hostKeyPrompt.stored_key && (
                  <>
                    <div className="text-xs text-term-fg-dim mt-3 mb-1">previously stored</div>
                    <div className="text-xs text-term-red break-all">
                      {hostKeyPrompt.stored_key}
                    </div>
                  </>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => handleHostKeyResponse(false)}
                  className="px-3 py-1.5 text-xs text-term-fg-dim hover:text-term-fg transition-colors"
                >
                  [ reject ]
                </button>
                <button
                  onClick={() => handleHostKeyResponse(true)}
                  className={`px-3 py-1.5 text-xs border transition-colors ${
                    hostKeyPrompt.status === 'new'
                      ? 'border-term-cyan text-term-cyan hover:bg-term-cyan hover:text-term-black'
                      : 'border-term-red text-term-red hover:bg-term-red hover:text-term-black'
                  }`}
                >
                  [ {hostKeyPrompt.status === 'new' ? 'accept' : 'accept anyway'} ]
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
