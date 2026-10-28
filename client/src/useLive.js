import { useEffect, useRef } from 'react';
import { getSocket } from './api';

/** Subscribes to server-pushed events for the signed-in user. handlers: { 'event:name': fn } */
export function useLive(handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const s = getSocket();
    const names = Object.keys(ref.current);
    const bound = names.map((n) => [n, (p) => ref.current[n]?.(p)]);
    bound.forEach(([n, fn]) => s.on(n, fn));
    return () => bound.forEach(([n, fn]) => s.off(n, fn));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
