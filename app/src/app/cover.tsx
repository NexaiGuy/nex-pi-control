// Het volledige cover-scherm (Flex Window van de Galaxy Z Flip, via Good Lock MultiStar), of na een tik op de
// Flex Window-widget. Telkens het scherm in beeld komt: 3 s het Nex AI-logo, daarna de draaiende Pi-behuizing als
// laadscherm (minstens 1,8 s en tot er verse gegevens zijn), dan het dashboard met alle parameters.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOverview } from '@/api/hooks';
import { ErrorState } from '@/components/overlays';
import { CoverDashboard } from '@/features/cover/CoverDashboard';
import { CoverLogo, CoverSpin, LOGO_MS, SPIN_MAX_MS, SPIN_MIN_MS } from '@/features/cover/CoverIntro';
import { t } from '@/i18n';
import { connectionStore, serverName } from '@/state/settings';
import { useStore } from '@/state/store';
import { colors } from '@/theme/tokens';

type Phase = 'logo' | 'spin' | 'data';

/** Gegevens jonger dan dit tellen als vers: dan hoeft het laadscherm niet op een nieuw antwoord te wachten. */
const FRESH_MS = 10_000;

export default function CoverRoute() {
  const q = useOverview();
  const conn = useStore(connectionStore);
  const [run, setRun] = useState(0);
  const [logoDone, setLogoDone] = useState(false);
  const [spinMin, setSpinMin] = useState(false);
  const [spinMax, setSpinMax] = useState(false);
  const [freshAtMin, setFreshAtMin] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const lastData = useRef(0);

  useEffect(() => {
    lastData.current = q.dataUpdatedAt;
  }, [q.dataUpdatedAt]);

  const replay = useCallback(() => {
    setLogoDone(false);
    setSpinMin(false);
    setSpinMax(false);
    setFreshAtMin(false);
    setSkipped(false);
    setRun((r) => r + 1);
  }, []);

  // Elke keer: als het scherm in beeld komt en als de app terugkomt op het cover-scherm.
  useFocusEffect(replay);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') replay();
    });
    return () => sub.remove();
  }, [replay]);

  // De klok van het intro: logo, minimum van het laadscherm, en een maximum zodat je nooit blijft hangen.
  useEffect(() => {
    const a = setTimeout(() => setLogoDone(true), LOGO_MS);
    const b = setTimeout(() => {
      setFreshAtMin(lastData.current > 0 && Date.now() - lastData.current < FRESH_MS);
      setSpinMin(true);
    }, LOGO_MS + SPIN_MIN_MS);
    const c = setTimeout(() => setSpinMax(true), LOGO_MS + SPIN_MAX_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
      clearTimeout(c);
    };
  }, [run]);

  const fresh = q.isFetchedAfterMount || q.isError || freshAtMin;
  const phase: Phase = !logoDone && !skipped ? 'logo' : skipped || spinMax || (spinMin && fresh) ? 'data' : 'spin';

  const server = serverName(conn);
  const o = q.data;
  // Tik tijdens het intro: meteen naar de cijfers, als die er al zijn.
  const skip = () => {
    if (o) setSkipped(true);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'left', 'right']}>
      {phase === 'data' ? (
        o ? (
          <CoverDashboard o={o} server={server} updatedAt={q.dataUpdatedAt} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
            <ErrorState error={q.error ?? new Error(t.cover.noData)} onRetry={() => void q.refetch()} />
          </View>
        )
      ) : (
        <Pressable style={{ flex: 1 }} onPress={skip} accessibilityRole="button" accessibilityLabel={t.cover.details}>
          {phase === 'logo' ? <CoverLogo key={run} size={190} /> : <CoverSpin server={server} label={t.cover.connecting} />}
        </Pressable>
      )}
    </SafeAreaView>
  );
}
