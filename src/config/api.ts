// Central API base URL
// In production (Vercel): set VITE_API_URL = https://your-render-service.onrender.com
// In development: defaults to http://localhost:3001
export const API_BASE_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || 'http://localhost:3001';

export const API = `${API_BASE_URL}/api`;

// Warn in development if VITE_API_URL is not set but we're not on localhost
if (
  typeof window !== 'undefined' &&
  import.meta.env.DEV &&
  !import.meta.env.VITE_API_URL
) {
  console.info('[Lectomate] VITE_API_URL not set — using http://localhost:3001');
}
