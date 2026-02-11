import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import type { Machine, WSMessage } from '../types';
import { getSSHWebSocketUrl } from '../services/api';

interface TerminalProps {
  machine: Machine;
  onStatusChange?: (machineId: number, status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
}

interface HostKeyVerifyData {
  status: 'new' | 'mismatch';
  fingerprint: string;
  stored_key?: string;
}

export default function Terminal({ machine, onStatusChange }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyVerifyData | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Notify parent of status changes
  useEffect(() => {
    onStatusChange?.(machine.id, status);
  }, [machine.id, status, onStatusChange]);

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

  const connect = () => {
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
    console.log('Connecting to WebSocket:', wsUrl.replace(/token=[^&]+/, 'token=***'));

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected, waiting for ready signal');
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);

        switch (msg.type) {
          case 'ready':
            // Server is ready, send encryption key via secure WebSocket channel
            console.log('Sending auth credentials');
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
      console.log('WebSocket closed:', event.code, event.reason);
      setStatus((prev) => prev === 'error' ? 'error' : 'disconnected');
      if (term && event.code !== 1000) {
        term.writeln('\r\n\x1b[33mConnection closed\x1b[0m');
      }
    };

    ws.onerror = (event) => {
      console.error('WebSocket error:', event);
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
  };

  // Initialize on mount and when machine changes
  useEffect(() => {
    // Small delay to ensure container is rendered
    const initTimeout = setTimeout(() => {
      connect();
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
  }, [machine.id]);

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

  const handleReconnect = () => {
    connect();
  };

  return (
    <div className="h-full flex flex-col bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${
            status === 'connected' ? 'bg-green-500' :
            status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
            status === 'error' ? 'bg-red-500' :
            'bg-slate-500'
          }`} />
          <span className="text-white font-medium">{machine.name}</span>
          <span className="text-slate-400 text-sm">
            ({machine.username}@{machine.hostname})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(status === 'disconnected' || status === 'error') && (
            <button
              onClick={handleReconnect}
              className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              Reconnect
            </button>
          )}
          <span className={`text-xs px-2 py-1 rounded ${
            status === 'connected' ? 'bg-green-500/20 text-green-400' :
            status === 'connecting' ? 'bg-yellow-500/20 text-yellow-400' :
            status === 'error' ? 'bg-red-500/20 text-red-400' :
            'bg-slate-500/20 text-slate-400'
          }`}>
            {status}
          </span>
        </div>
      </div>

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
