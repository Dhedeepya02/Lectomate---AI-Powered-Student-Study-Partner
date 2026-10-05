import React, { useState, useEffect, useCallback } from 'react';
import { X, Mail, Lock, User as UserIcon, Wifi, WifiOff, RefreshCw, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config/api';

interface AuthModalProps {
  onClose: () => void;
  onLogin: () => void;
}

type ServerStatus = 'checking' | 'online' | 'offline';

export const AuthModal: React.FC<AuthModalProps> = ({ onClose, onLogin }) => {
  const [isLogin, setIsLogin]       = useState(true);
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [name, setName]             = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');
  const { login, register }         = useUser();

  // ── Server connectivity check ─────────────────────────────────────────────
  const checkServer = useCallback(async () => {
    setServerStatus('checking');
    setError('');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${API_BASE_URL}/health`, {
        signal: controller.signal,
        // Prevent browser from caching the health ping
        cache: 'no-store',
      });
      clearTimeout(timer);
      setServerStatus(res.ok ? 'online' : 'offline');
    } catch {
      setServerStatus('offline');
    }
  }, []);

  useEffect(() => {
    checkServer();
  }, [checkServer]);

  // ── Form submit ───────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (serverStatus === 'checking') return;

    if (serverStatus === 'offline') {
      setError('Server is not reachable. Make sure the backend is running and click Retry.');
      return;
    }

    // Client-side validation
    const trimmedEmail    = email.trim();
    const trimmedName     = name.trim();
    const trimmedPassword = password;

    if (!trimmedEmail) { setError('Email is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) { setError('Please enter a valid email address.'); return; }
    if (!trimmedPassword) { setError('Password is required.'); return; }
    if (trimmedPassword.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (!isLogin && !trimmedName) { setError('Name is required.'); return; }

    setLoading(true);
    setError('');

    try {
      let result: boolean | string = false;

      if (isLogin) {
        result = await login(trimmedEmail, trimmedPassword);
      } else {
        result = await register(trimmedName, trimmedEmail, trimmedPassword);
      }

      if (result === true) {
        onLogin();
        onClose();
      } else if (typeof result === 'string') {
        // Re-run connectivity check when we get a connection error
        const msg = result.toLowerCase();
        if (msg.includes('connection') || msg.includes('network') || msg.includes('fetch')) {
          setServerStatus('offline');
          setError('Lost connection to the server. Please retry.');
        } else {
          setError(result);
        }
      } else {
        setError(isLogin ? 'Invalid email or password.' : 'Registration failed. Please try again.');
      }
    } catch {
      setServerStatus('offline');
      setError('Connection error. Make sure the server is running.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setIsLogin(v => !v);
    setError('');
    setEmail('');
    setPassword('');
    setName('');
    setShowPassword(false);
  };

  const isSubmitDisabled = loading || serverStatus === 'offline' || serverStatus === 'checking';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">

        {/* Top gradient bar */}
        <div className="h-1 bg-gradient-to-r from-blue-500 via-teal-500 to-blue-600" />

        <div className="p-8">
          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={20} />
          </button>

          {/* Heading */}
          <div className="text-center mb-7">
            <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white mb-1">
              {isLogin ? 'Welcome back' : 'Create account'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isLogin ? 'Sign in to continue learning' : 'Get started with Lectomate for free'}
            </p>
          </div>

          {/* ── Server status banner ──────────────────────────────────────── */}
          {serverStatus === 'checking' && (
            <div className="flex items-center gap-2.5 p-3 mb-5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-500 dark:text-gray-400 text-xs">
              <RefreshCw size={13} className="animate-spin shrink-0 text-blue-500" />
              <span>Connecting to server…</span>
            </div>
          )}

          {serverStatus === 'offline' && (
            <div className="flex items-start gap-2.5 p-3 mb-5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-xs">
              <WifiOff size={13} className="shrink-0 mt-0.5 text-red-500 dark:text-red-400" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-red-700 dark:text-red-400">Server is not reachable</p>
                <p className="mt-0.5 text-red-600 dark:text-red-400 opacity-80">
                  Run{' '}
                  <code className="font-mono bg-red-100 dark:bg-red-900/40 px-1 py-0.5 rounded">
                    node simple-server.js
                  </code>{' '}
                  in the server folder, then retry.
                </p>
              </div>
              <button
                type="button"
                onClick={checkServer}
                className="shrink-0 flex items-center gap-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 font-semibold transition-colors whitespace-nowrap"
              >
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          )}

          {serverStatus === 'online' && (
            <div className="flex items-center gap-2.5 p-3 mb-5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-green-700 dark:text-green-400 text-xs">
              <Wifi size={13} className="shrink-0" />
              <span>Server connected</span>
            </div>
          )}

          {/* ── Form ─────────────────────────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>

            {/* Name (register only) */}
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Full Name
                </label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={17} />
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
                    placeholder="Your full name"
                    autoComplete="name"
                    disabled={loading}
                  />
                </div>
              </div>
            )}

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={17} />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={17} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
                  placeholder={isLogin ? 'Your password' : 'At least 6 characters'}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2.5 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-semibold hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <RefreshCw size={15} className="animate-spin" />
                  {isLogin ? 'Signing in…' : 'Creating account…'}
                </>
              ) : serverStatus === 'checking' ? (
                <>
                  <RefreshCw size={15} className="animate-spin" />
                  Checking connection…
                </>
              ) : serverStatus === 'offline' ? (
                <>
                  <WifiOff size={15} />
                  Server offline — cannot connect
                </>
              ) : (
                isLogin ? 'Sign In' : 'Create Account'
              )}
            </button>
          </form>

          {/* Switch mode */}
          <div className="mt-5 text-center">
            <button
              onClick={switchMode}
              className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors font-medium"
            >
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
