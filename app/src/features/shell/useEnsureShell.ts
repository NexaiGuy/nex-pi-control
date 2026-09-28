import { useState } from 'react';

import { api, errorMessage } from '@/api/client';
import { useShellStart, useShellState } from '@/api/hooks';
import type { ShellStatus } from '@/api/types';
import { toast } from '@/components/overlays';
import { authenticate } from '@/features/lock/LockGate';
import { t } from '@/i18n';

async function waitForShell(timeoutMs = 20000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      await api.shellGet<ShellStatus>('/v1/status');
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

/** Zorgt dat hal-shell draait (na vingerafdruk). Gedeeld door terminal en bestanden. */
export function useEnsureShell() {
  const state = useShellState(10000);
  const start = useShellStart();
  const [busy, setBusy] = useState(false);
  const ensure = async (): Promise<boolean> => {
    if (!(await authenticate(t.terminal.biometricReason))) return false;
    setBusy(true);
    try {
      if (!state.data?.active) {
        const r = await start.mutateAsync(undefined);
        if (!r.ok) throw new Error(r.message);
      }
      const ok = await waitForShell();
      if (!ok) throw new Error(t.errors.shellNoAnswer);
      await state.refetch();
      return true;
    } catch (e) {
      toast.error(e instanceof Error && !('kind' in e) ? e.message : errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { active: !!state.data?.active, busy, ensure, state };
}
