// Types die exact overeenkomen met de antwoorden van hal-agent en hal-shell.

export type Level = 'ok' | 'warning' | 'critical';

export interface HealthReason {
  level: 'warning' | 'critical';
  code: string;
  text: string;
  target: string | null;
}

export interface Throttling {
  available: boolean;
  now: string[];
  past: string[];
  raw: string | null;
  active: boolean;
}

export interface SystemSnapshot {
  ts: number;
  cpu: { percent: number; per_core: number[]; cores: number; freq_mhz: number | null };
  load: [number, number, number] | number[];
  memory: { total: number; used: number; available: number; percent: number };
  swap: { total: number; used: number; percent: number };
  temperature_c: number | null;
  throttling: Throttling;
  fan_rpm: number | null;
  network: { rx_bps: number; tx_bps: number };
  disk_io: { read_bps: number; write_bps: number };
  uptime_seconds: number;
}

export interface Mount {
  device: string;
  mountpoint: string;
  fstype: string;
  total: number;
  used: number;
  free: number;
  percent: number;
}

export type SmartStatus = 'ok' | 'warning' | 'failing' | 'unknown';

export interface SmartSummary {
  device: string;
  status: SmartStatus;
  model?: string | null;
}

export interface SmartDisk extends SmartSummary {
  serial?: string;
  firmware?: string;
  protocol?: string;
  capacity_bytes?: number | null;
  temperature_c?: number | null;
  power_on_hours?: number | null;
  smart_supported?: boolean;
  attributes: Record<string, number>;
  crc_errors?: number | null;
  reasons: string[];
  collected_at?: number | null;
}

export interface DiskAlarm {
  device: string;
  status: SmartStatus;
  model?: string | null;
  message: string;
  reasons: string[];
}

export interface Counts {
  services: { active: number; failed: number; total: number };
  containers: { running: number; stopped: number; total: number };
  sites: { up: number; down: number; total: number };
  last_backup_age_seconds: number | null;
}

export interface Overview {
  ts: number;
  health: { status: Level; title: string; reasons: HealthReason[] };
  disk_alarms: DiskAlarm[];
  system: SystemSnapshot;
  mounts: Mount[];
  smart: SmartSummary[];
  counts: Counts;
}

export interface Info {
  version: string;
  hostname: string;
  confirm_name: string;
  mock: boolean;
  gpio_available: boolean;
  shell_url: string | null;
  access_configured: boolean;
  scenario?: string;
  /** Sinds agent 1.2.0: welke nieuwere functies deze agent kent. */
  features?: string[];
}

export interface DeviceInfo {
  hostname: string;
  model: string;
  serial: string;
  os: string;
  kernel: string;
  arch: string;
  python: string;
  cpu_cores: number;
  memory_total: number;
  addresses: { interface: string; address: string }[];
  boot_time: number;
}

export interface Disks {
  mounts: Mount[];
  smart: SmartDisk[];
  disk_alarms: DiskAlarm[];
}

export type RangeKey = '1h' | '6h' | '24h' | '7d' | '30d';
export type Point = [number, number | null, number | null, number | null];

export interface MetricMeta {
  metric: string;
  label: string;
  unit: string;
  group: string;
  group_label?: string;
}

export interface Series extends MetricMeta {
  range: RangeKey;
  bucket_seconds: number;
  points: Point[];
  summary: { min: number | null; avg: number | null; max: number | null; current: number | null };
}

export interface Service {
  name: string;
  description: string;
  active: string;
  sub: string;
  enabled: string;
  uptime_seconds: number | null;
  memory_bytes: number | null;
  main_pid: number | null;
  restarts: number;
  restart_allowed: boolean;
  custom?: boolean;
}

export interface LogLine {
  ts: number;
  level: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug';
  message: string;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: number | null;
  project: string;
  service: string | null;
  ports: { private: number | null; public: number | null; ip: string | null; type: string | null }[];
  restart_count?: number;
  health?: string;
  exit_code?: number | null;
  oom_killed?: boolean;
  restart_policy?: string | null;
  cpu_percent?: number;
  memory_bytes?: number;
  memory_limit?: number | null;
  /** Sinds agent 1.2.0. */
  restart_allowed?: boolean;
}

export interface ContainersResponse {
  containers: Container[];
  updated_at: number | null;
  error: string | null;
}

export interface Site {
  hostname: string;
  url?: string;
  local?: string | null;
  status_code?: number | null;
  latency_ms?: number | null;
  state: 'up' | 'protected' | 'warning' | 'down';
  error?: string;
  tls_expires_at?: number | null;
  tls_days_left?: number;
  local_status?: number | null;
  local_latency_ms?: number | null;
  local_state?: string;
  local_error?: string;
  checked_at?: number;
}

export interface Process {
  pid: number;
  name: string;
  user: string;
  status: string;
  cpu_percent: number;
  memory_bytes: number;
  memory_percent: number;
  threads: number;
  started_at: number;
  command: string;
}

export interface Backup {
  name: string;
  path: string;
  state: 'ok' | 'empty' | 'no_access';
  latest_file?: string;
  latest_at?: number;
  latest_size?: number;
  age_seconds?: number;
  total_size?: number;
  files?: number;
}

export interface Ports {
  registry: { port: number; address: string; service: string; listening: boolean }[];
  unregistered_listening: number[];
  error: string | null;
}

export interface GpioPin {
  pin: number;
  name: string;
  kind: 'power' | 'ground' | 'gpio' | 'i2c' | 'spi' | 'uart' | 'eeprom';
  bcm?: number;
  alt?: string;
  label?: string | null;
  allowed?: boolean;
  mode?: 'in' | 'out';
  value?: number | null;
  owner?: string | null;
  pulsing?: boolean;
  protected_reason?: string;
}

export interface GpioState {
  available: boolean;
  error: string | null;
  pins: GpioPin[];
}

export interface Sensor {
  id: string;
  name: string;
  type: 'ds18b20' | 'dht' | 'bmp280';
  values: { temp?: number; humidity?: number; pressure?: number } | null;
  error: string | null;
  ts: number | null;
}

export interface SensorsResponse {
  sensors: Sensor[];
  discovered: { ds18b20: string[]; iio: string[]; i2c_buses: string[] };
}

export interface LastRun {
  ts: number;
  actor: string;
  result: string;
  detail: string;
}

export interface Command {
  id: string;
  name: string;
  description: string;
  icon: string;
  dangerous: boolean;
  timeout: number;
  effect: string;
  last_run: LastRun | null;
}

export interface CommandResult {
  ok: boolean;
  output: string[];
  reason: string;
}

export interface WolDevice {
  id: string;
  name: string;
  mac: string;
  broadcast: string;
  port: number;
  last_woken: LastRun | null;
}

export interface AuditEntry {
  ts: number;
  actor: string;
  ip: string;
  action: string;
  target: string | null;
  result: string;
  detail: string;
  source: 'agent' | 'shell';
}

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export interface ShellState {
  active: boolean;
  state: string;
  active_seconds: number | null;
  url: string | null;
  idle_timeout_seconds: number;
}

// hal-shell
export interface ShellStatus {
  ok: boolean;
  user: string;
  sessions: number;
  idle_timeout_seconds: number;
  idle_remaining_seconds: number;
}

export interface FileRoot {
  path: string;
  label: string;
  writable: boolean;
  exists: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'dir' | 'file' | 'link' | 'unknown';
  size: number | null;
  modified: number;
  mode: string;
  hidden: boolean;
}

export interface DirListing {
  path: string;
  root: string;
  writable: boolean;
  parent: string | null;
  entries: FileEntry[];
}

export interface FileContent {
  path: string;
  binary: boolean;
  content?: string;
  truncated?: boolean;
  size: number;
  modified: number;
  writable?: boolean;
}

// --- Agent 1.2.0: gebeurtenissen, updates, containers herstarten ------------------------------------

export type EventLevel = 'ok' | 'info' | 'warning' | 'critical';

export interface AgentEvent {
  id: number;
  ts: number;
  level: EventLevel;
  kind: 'disk' | 'service' | 'container' | 'site' | 'updates' | string;
  key: string;
  resolved: boolean;
  title: string;
  body: string;
}

export interface EventsResponse {
  last_id: number;
  open: number;
  events: AgentEvent[];
}

export interface UnitRun {
  running: boolean;
  state: string;
  result: string | null;
  exit_status: number | null;
  started_at: number | null;
  finished_at: number | null;
  log: string[];
}

export interface AptPackage {
  name: string;
  from: string;
  to: string;
  security: boolean;
}

export interface UpdatesState {
  checked_at: number | null;
  count: number;
  security_count: number;
  packages: AptPackage[];
  reboot_required: boolean;
  error: string | null;
  allowed: boolean;
  checking: boolean;
  upgrade: UnitRun;
  blocked_reason: string | null;
}

export interface AgentUpdateState {
  current: string;
  latest: string | null;
  tag: string | null;
  url: string | null;
  notes: string;
  error: string | null;
  update_available: boolean;
  allowed: boolean;
  run: UnitRun;
}

export interface ContainerRestartResult {
  ok: boolean;
  name: string;
  output: string[];
  message: string;
}
