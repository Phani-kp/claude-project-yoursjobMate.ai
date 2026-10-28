import { io } from 'socket.io-client';

const TOKEN_KEY = 'jobmate_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = { Authorization: `Bearer ${getToken() || ''}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, { method, headers, body: form || (body && JSON.stringify(body)) });
  if (res.status === 401 && !path.startsWith('/auth')) {
    setToken(null);
    window.location.assign('/login');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

let socket = null;
export function getSocket() {
  if (!socket) socket = io({ auth: { token: getToken() }, transports: ['websocket', 'polling'] });
  return socket;
}
export function closeSocket() {
  socket?.disconnect();
  socket = null;
}

export const STATUSES = ['queued', 'applying', 'applied', 'viewed', 'interview', 'offer', 'rejected', 'failed'];

export const fmtDate = (s) => (s ? new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
export const timeAgo = (s) => {
  if (!s) return '';
  const t = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).getTime();
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};
