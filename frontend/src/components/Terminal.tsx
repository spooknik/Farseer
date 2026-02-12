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
    <div className="h-full flex flex-col bg-term-black">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 bg-term-surface-alt border-b border-term-border">
        <div className="flex items-center gap-2 text-xs">
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
          <span className="text-term-fg-bright">{machine.username}@{machine.hostname}</span>
          <span className="text-term-fg-muted">::</span>
          <span className="text-term-fg">{machine.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {(status === 'disconnected' || status === 'error') && (
            <button
              onClick={handleReconnect}
              className="text-xs text-term-fg-dim hover:text-term-cyan transition-colors"
            >
              [retry]
            </button>
          )}
          <span className={`text-xs ${
            status === 'connected' ? 'text-term-green' :
            status === 'connecting' ? 'text-term-yellow' :
            status === 'error' ? 'text-term-red' :
            'text-term-fg-dim'
          }`}>
            [{status}]
          </span>
        </div>
      </div>

      {/* Terminal */}
      <div ref={terminalRef} className="flex-1 overflow-hidden" />

      {/* Host Key Verification Modal */}
      {hostKeyPrompt && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="border border-term-border bg-term-surface max-w-lg w-full flex flex-col">
            <div className="px-3 py-1.5 bg-term-surface-alt border-b border-term-border">
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
