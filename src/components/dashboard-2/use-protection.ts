'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  initialProtectionState,
  type Facility,
  type ProtectionAction,
  type ProtectionState,
} from '@/lib/haven/engine';

export function useProtection(facility: Facility, enabled: boolean) {
  const [state, setState] = useState(() => initialProtectionState(facility));
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loaded = useRef<string | null>(null);
  const inFlight = useRef(false);
  const currentFacility = useRef(facility);
  currentFacility.current = facility;
  const currentState = useRef(state);
  currentState.current = state;
  const load = useCallback(async () => {
    const target = currentFacility.current;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        name: target.name,
        city: target.city,
        type: target.type,
      });
      const response = await fetch(`/api/protection/${target.id}?${query}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Cannot load the protection workspace.');
      if (currentFacility.current.id === target.id) {
        setState(data);
        loaded.current = target.id;
      }
    } catch (e) {
      if (currentFacility.current.id === target.id) setError((e as Error).message);
    } finally {
      if (currentFacility.current.id === target.id) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (state.facility.id !== facility.id) {
      setState(initialProtectionState(facility));
      loaded.current = null;
      setError('');
    }
    if (enabled && loaded.current !== facility.id) void load();
  }, [facility.id, enabled, load]);
  const act = useCallback(async (command: ProtectionAction) => {
    if (inFlight.current || loaded.current !== currentFacility.current.id) return null;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const target = currentFacility.current;
    try {
      const response = await fetch(`/api/protection/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facility: target,
          revision: currentState.current.revision,
          command,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The protection change was not saved.');
      if (currentFacility.current.id === target.id) {
        currentState.current = data;
        setState(data);
      }
      return data as ProtectionState;
    } catch (e) {
      if (currentFacility.current.id === target.id) setError((e as Error).message);
      return null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);
  // After the server copy is deleted, start this facility from a clean local state.
  const forget = useCallback(() => {
    loaded.current = null;
    setState(initialProtectionState(currentFacility.current));
    setError('');
  }, []);
  return {
    state: state.facility.id === facility.id ? state : initialProtectionState(facility),
    /** True once this facility's saved workspace has been read from the server. */
    loaded: loaded.current === facility.id && state.facility.id === facility.id,
    forget,
    loading: loading || (enabled && loaded.current !== facility.id && !error),
    busy,
    error,
    act,
    reload: load,
  };
}
