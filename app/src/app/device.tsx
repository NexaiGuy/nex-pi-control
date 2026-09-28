import { useDevice, useInfo } from '@/api/hooks';
import { DetailScreen } from '@/components/layout';
import { ErrorState, SkeletonList } from '@/components/overlays';
import { Card, KeyValue, SectionTitle, StatusPill } from '@/components/primitives';
import { t } from '@/i18n';
import { bytes, dateTime } from '@/lib/format';

export default function DeviceScreen() {
  const d = useDevice();
  const info = useInfo();
  return (
    <DetailScreen title={t.more.device} onRefresh={() => void Promise.all([d.refetch(), info.refetch()])} refreshing={d.isRefetching}>
      {!d.data && d.isLoading ? <SkeletonList rows={4} /> : null}
      {!d.data && d.error ? <ErrorState error={d.error} onRetry={() => void d.refetch()} /> : null}
      {d.data ? (
        <Card>
          <KeyValue k={t.device.model} v={d.data.model} />
          <KeyValue k={t.device.hostname} v={d.data.hostname} />
          <KeyValue k={t.device.serial} v={d.data.serial || '–'} />
          <KeyValue k={t.device.os} v={d.data.os} />
          <KeyValue k={t.device.kernel} v={d.data.kernel} />
          <KeyValue k={t.device.arch} v={d.data.arch} />
          <KeyValue k={t.device.cores} v={String(d.data.cpu_cores)} />
          <KeyValue k={t.device.ram} v={bytes(d.data.memory_total, 0)} />
          <KeyValue k={t.device.booted} v={dateTime(d.data.boot_time)} />
          {d.data.addresses.map((a) => (
            <KeyValue key={a.interface + a.address} k={a.interface} v={a.address} />
          ))}
        </Card>
      ) : null}
      {info.data ? (
        <>
          <SectionTitle>{t.device.agent}</SectionTitle>
          <Card>
            <KeyValue k={t.device.version} v={info.data.version} />
            <KeyValue k="Python" v={d.data?.python ?? '–'} />
            <KeyValue k={t.device.access} v={<StatusPill compact level={info.data.access_configured ? 'ok' : 'warning'} label={info.data.access_configured ? t.device.configured : t.device.notConfigured} />} />
            <KeyValue k={t.device.gpio} v={info.data.gpio_available ? t.device.available : t.device.unavailable} />
            {info.data.mock ? <KeyValue k={t.device.mode} v={`mock (${info.data.scenario ?? 'ok'})`} /> : null}
          </Card>
        </>
      ) : null}
    </DetailScreen>
  );
}
