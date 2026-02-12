import { useState, useRef, FormEvent, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setup, login, verifyTOTP, checkSetupStatus } from '../services/api';
import { deriveEncryptionKey } from '../utils/crypto';
import { QRCodeSVG } from 'qrcode.react';
import type { LoginResponse } from '../types';

interface LoginProps {
  onLogin: () => void;
}

type Step = 'credentials' | 'totp_setup' | 'totp_verify';

const FARSEER_LOGO = `
 ███████╗ █████╗ ██████╗ ███████╗███████╗███████╗██████╗
 ██╔════╝██╔══██╗██╔══██╗██╔════╝██╔════╝██╔════╝██╔══██╗
 █████╗  ███████║██████╔╝███████╗█████╗  █████╗  ██████╔╝
 ██╔══╝  ██╔══██║██╔══██╗╚════██║██╔══╝  ██╔══╝  ██╔══██╗
 ██║     ██║  ██║██║  ██║███████║███████╗███████╗██║  ██║
 ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝`;

export default function Login({ onLogin }: LoginProps) {
  const [isSetup, setIsSetup] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [step, setStep] = useState<Step>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [totpQrUrl, setTotpQrUrl] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [encryptionKey, setEncryptionKey] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const totpInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    checkSetupStatus()
      .then((status) => {
        setIsSetup(status.setup_complete);
        setIsLoading(false);
      })
      .catch(() => {
        setIsLoading(false);
      });
  }, []);

  // Auto-focus TOTP input when step changes
  useEffect(() => {
    if (step === 'totp_setup' || step === 'totp_verify') {
      setTimeout(() => totpInputRef.current?.focus(), 100);
    }
  }, [step]);

  const handleLoginResponse = (response: LoginResponse, derivedKey: string) => {
    if (response.token && response.user) {
      // Full auth — login complete
      localStorage.setItem('token', response.token);
      localStorage.setItem('encryptionKey', derivedKey);
      localStorage.setItem('userId', response.user.id.toString());
      onLogin();
      navigate('/');
      return;
    }

    // Store encryption key for after TOTP verification
    setEncryptionKey(derivedKey);
    setTempToken(response.temp_token || '');

    if (response.requires_totp_setup) {
      setTotpSecret(response.totp_secret || '');
      setTotpQrUrl(response.totp_qr_url || '');
      setStep('totp_setup');
    } else if (response.requires_totp) {
      setStep('totp_verify');
    }
  };

  const handleCredentialSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isSetup) {
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters');
        return;
      }
    }

    setSubmitting(true);
    try {
      const response = isSetup
        ? await login(username, password)
        : await setup(username, password);

      const derivedKey = await deriveEncryptionKey(username, password);
      handleLoginResponse(response, derivedKey);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTotpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (totpCode.length !== 6) {
      setError('Enter a 6-digit code');
      return;
    }

    setSubmitting(true);
    try {
      const response = await verifyTOTP(tempToken, totpCode);
      handleLoginResponse(response, encryptionKey);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Verification failed');
      setTotpCode('');
      totpInputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const handleTotpCodeChange = (value: string) => {
    // Only allow digits, max 6
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setTotpCode(digits);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-term-black">
        <span className="text-term-fg-dim text-xs">loading<span className="cursor-blink"></span></span>
      </div>
    );
  }

  const getStepTitle = () => {
    if (step === 'credentials') return isSetup ? 'login' : 'setup';
    if (step === 'totp_setup') return '2fa enrollment';
    return '2fa verify';
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-term-black px-4">
      <div className="max-w-lg w-full">
        {/* Terminal window frame */}
        <div className="border border-term-border">
          {/* Title bar */}
          <div className="px-4 py-2 bg-term-surface-alt border-b border-term-border">
            <span className="text-term-fg-dim text-xs">
              --[ <span className="text-term-cyan">farseer</span> :: {getStepTitle()} ]--
            </span>
          </div>

          {/* Content */}
          <div className="bg-term-surface p-8">
            {/* ASCII logo */}
            <div className="text-center mb-8 overflow-x-auto">
              <pre
                className="text-term-cyan leading-none select-none inline-block text-left"
                style={{ fontSize: '8px' }}
              >
                {FARSEER_LOGO}
              </pre>
              <p className="text-term-fg-dim text-xs mt-3 tracking-widest">
                secure shell gateway
              </p>
            </div>

            {/* Error display */}
            {error && (
              <div className="text-term-red text-xs border border-term-red/30 bg-term-red-dim/30 px-3 py-2 mb-4">
                <span className="text-term-red mr-2">[ERROR]</span>{error}
              </div>
            )}

            {/* Step 1: Credentials */}
            {step === 'credentials' && (
              <form onSubmit={handleCredentialSubmit} className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-term-cyan text-sm flex-shrink-0">&gt;</span>
                  <span className="text-term-fg-dim text-sm flex-shrink-0">username:</span>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="flex-1 bg-transparent border-b border-term-border text-term-fg-bright text-sm py-1 px-0 focus:outline-none focus:border-term-cyan placeholder:text-term-fg-muted"
                    placeholder="_"
                    minLength={3}
                    autoFocus
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-term-cyan text-sm flex-shrink-0">&gt;</span>
                  <span className="text-term-fg-dim text-sm flex-shrink-0">password:</span>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="flex-1 bg-transparent border-b border-term-border text-term-fg-bright text-sm py-1 px-0 focus:outline-none focus:border-term-cyan placeholder:text-term-fg-muted"
                    placeholder="_"
                    minLength={8}
                  />
                </div>

                {!isSetup && (
                  <div className="flex items-center gap-2">
                    <span className="text-term-cyan text-sm flex-shrink-0">&gt;</span>
                    <span className="text-term-fg-dim text-sm flex-shrink-0">confirm&nbsp;:</span>
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="flex-1 bg-transparent border-b border-term-border text-term-fg-bright text-sm py-1 px-0 focus:outline-none focus:border-term-cyan placeholder:text-term-fg-muted"
                      placeholder="_"
                    />
                  </div>
                )}

                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2 text-sm border border-term-cyan text-term-cyan hover:bg-term-cyan hover:text-term-black transition-colors duration-150 tracking-wider uppercase disabled:opacity-50"
                  >
                    [ {submitting ? 'Authenticating...' : isSetup ? 'Authenticate' : 'Initialize'} ]
                  </button>
                </div>

                <p className="text-term-fg-muted text-xs text-center">
                  {isSetup ? 'enter credentials to continue' : 'first run -- create admin account'}
                </p>
              </form>
            )}

            {/* Step 2a: TOTP Enrollment */}
            {step === 'totp_setup' && (
              <div className="space-y-6">
                <div className="text-center space-y-2">
                  <p className="text-term-fg-dim text-xs">
                    scan this QR code with your authenticator app
                  </p>
                  <p className="text-term-fg-muted text-xs">
                    (Google Authenticator, Authy, 1Password, etc.)
                  </p>
                </div>

                {/* QR Code */}
                <div className="flex justify-center">
                  <div className="bg-white p-3 inline-block">
                    <QRCodeSVG value={totpQrUrl} size={180} />
                  </div>
                </div>

                {/* Manual entry secret */}
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="text-term-fg-muted text-xs hover:text-term-fg-dim transition-colors"
                  >
                    [ {showSecret ? 'hide' : 'show'} manual key ]
                  </button>
                  {showSecret && (
                    <div className="mt-2 bg-term-surface-alt border border-term-border px-3 py-2">
                      <code className="text-term-green text-xs tracking-widest select-all">
                        {totpSecret}
                      </code>
                    </div>
                  )}
                </div>

                {/* TOTP verification */}
                <form onSubmit={handleTotpSubmit} className="space-y-4">
                  <div className="flex items-center gap-2 justify-center">
                    <span className="text-term-cyan text-sm flex-shrink-0">&gt;</span>
                    <span className="text-term-fg-dim text-sm flex-shrink-0">code:</span>
                    <input
                      ref={totpInputRef}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={totpCode}
                      onChange={(e) => handleTotpCodeChange(e.target.value)}
                      className="w-32 bg-transparent border-b border-term-border text-term-fg-bright text-sm py-1 px-0 focus:outline-none focus:border-term-cyan text-center tracking-[0.5em] font-mono"
                      placeholder="______"
                      maxLength={6}
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={submitting || totpCode.length !== 6}
                      className="w-full py-2 text-sm border border-term-cyan text-term-cyan hover:bg-term-cyan hover:text-term-black transition-colors duration-150 tracking-wider uppercase disabled:opacity-50"
                    >
                      [ {submitting ? 'Verifying...' : 'Verify & Complete Setup'} ]
                    </button>
                  </div>

                  <p className="text-term-fg-muted text-xs text-center">
                    enter the 6-digit code from your authenticator
                  </p>
                </form>
              </div>
            )}

            {/* Step 2b: TOTP Verification (returning user) */}
            {step === 'totp_verify' && (
              <form onSubmit={handleTotpSubmit} className="space-y-4">
                <div className="text-center mb-4">
                  <p className="text-term-fg-dim text-xs">
                    enter your two-factor authentication code
                  </p>
                </div>

                <div className="flex items-center gap-2 justify-center">
                  <span className="text-term-cyan text-sm flex-shrink-0">&gt;</span>
                  <span className="text-term-fg-dim text-sm flex-shrink-0">2fa code:</span>
                  <input
                    ref={totpInputRef}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(e) => handleTotpCodeChange(e.target.value)}
                    className="w-32 bg-transparent border-b border-term-border text-term-fg-bright text-sm py-1 px-0 focus:outline-none focus:border-term-cyan text-center tracking-[0.5em] font-mono"
                    placeholder="______"
                    maxLength={6}
                  />
                </div>

                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={submitting || totpCode.length !== 6}
                    className="w-full py-2 text-sm border border-term-cyan text-term-cyan hover:bg-term-cyan hover:text-term-black transition-colors duration-150 tracking-wider uppercase disabled:opacity-50"
                  >
                    [ {submitting ? 'Verifying...' : 'Verify'} ]
                  </button>
                </div>

                <p className="text-term-fg-muted text-xs text-center">
                  open your authenticator app for the code
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
