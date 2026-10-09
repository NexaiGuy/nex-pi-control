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

export interface Partition {
  device: string;
  size_bytes: number;
  fstype: string;
  label: string;
  mountpoints: string[];
  /** Het mountpunt dat de agent toont (bij meerdere: het echte, niet een sandbox-bind zoals /var/tmp). */
  mountpoint?: string | null;
  used?: number | null;
  total?: number | null;
  /** Vrij voor gewone gebruikers (zonder root-reserve). Sinds agent 1.2.6. */
  free?: number | null;
  percent?: number | null;
}

/** Sinds agent 1.2.1: elke fysieke schijf (SD, NVMe, SATA, USB) met partities en de SMART-beoordeling. */
export interface PhysicalDisk extends SmartDisk {
  transport?: string;
  size_bytes?: number | null;
  removable?: boolean;
  device_type?: string;
  /** false als de USB-adapter het foutlogboek niet doorgeeft (geen faalsignaal). */
  error_log_available?: boolean;
  /** "attributes": de adapter kent het statuscommando niet, gezondheid afgeleid uit de attributen. */
  health_source?: 'smart' | 'attributes';
  partitions?: Partition[];
}

export interface DiskAlarm {
  device: string;
  status: SmartStatus;
  model?: string | null;
  message: string;
  reasons: string[];
}

/** Sinds agent 1.3.0: `total` telt enkel wat bewaakt wordt, `parked` wat bewust uit staat, `all` alles samen. */
interface CountExtra {
  parked?: number;
  all?: number;
}

export interface Counts {
  services: { active: number; failed: number; total: number } & CountExtra;
  containers: { running: number; stopped: number; total: number } & CountExtra;
  /** warning: antwoordt met een foutcode (4xx). Ontbreekt bij agents ouder dan 1.2.5. */
  sites: { up: number; down: number; warning?: number; total: number } & CountExtra;
  last_backup_age_seconds: number | null;
  /** Ontbreekt bij agents ouder dan 1.2.5. */
  backups?: { failed: number; old: number; total: number };
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
  disks?: PhysicalDisk[];
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

/** Waarom iets als bewust uit telt: in de app gezet, groups.yml, uitgeschakelde dienst, gestopte container, backend uit. */
export type ParkedReason = 'app' | 'config' | 'disabled' | 'stopped' | 'backend';

/** Sinds agent 1.3.0: bewust uit en categorie (zie agent/hal_agent/labels.py). Ontbreekt bij oudere agents. */
export interface Labeled {
  /** Staat nu bewust uit: telt niet als probleem, geeft geen melding. Enkel zolang het niet draait. */
  parked?: boolean;
  parked_reason?: ParkedReason | null;
  /** Wat in de app ingesteld is: true = bewust uit, false = altijd bewaken, null = automatisch. */
  parked_setting?: boolean | null;
  /** Regel die het bewust uit maakt als het niet draait (groups.yml of automatisch), los van de app. */
  parked_rule?: ParkedReason | null;
  group?: string;
  group_source?: 'app' | 'config' | 'auto';
  /** Volgorde van de secties: eigen categorieën eerst, systeem achteraan. */
  group_order?: number;
}

export type LabelKind = 'service' | 'container' | 'site';

export interface LabelsInfo {
  groups: { name: string; source: 'config' | 'app' }[];
  auto_parked: boolean;
  editable: boolean;
}

export interface LabelResult {
  ok: boolean;
  kind: LabelKind;
  name: string;
  parked_setting: boolean | null;
  group_setting: string | null;
}

export interface Service extends Labeled {
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

export interface Container extends Labeled {
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
  /** Sinds agent 1.3.0: gepubliceerde poorten, ook als de container gestopt is. */
  host_ports?: number[];
  /** Sinds agent 1.3.0: laatste healthcheck van een gestopte container (health zelf is dan "geen"). */
  last_health?: string | null;
}

export interface ContainersResponse {
  containers: Container[];
  updated_at: number | null;
  error: string | null;
}

export interface Site extends Labeled {
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
  /** Waar de hostname vandaan komt: de tunnel (cloudflared-config), nginx of sites.yml. */
  source?: string | null;
  /** Gezet als / een foutcode gaf en een healthpad wel antwoordde (agent 1.2.5+). */
  probe_path?: string;
  root_status?: number;
}

export interface SiteDiscovery {
  enabled: boolean;
  generated_at: number | null;
  sources: { label: string; kind: string; count: number }[];
  /** Tunnels met een token: hun hostnames staan enkel in het Cloudflare-dashboard. */
  remote_tunnels: string[];
  excluded: number;
}

export interface SitesResponse {
  sites: Site[];
  updated_at: number | null;
  discovery?: SiteDiscovery;
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
  state: 'ok' | 'empty' | 'no_access' | 'failed';
  latest_file?: string;
  latest_at?: number;
  latest_size?: number;
  age_seconds?: number;
  total_size?: number;
  files?: number;
  /** Sinds agent 1.2.1: "job" wordt bewaakt, "archive" (eenmalige kopie of genegeerd) nooit. */
  kind?: 'job' | 'archive';
  reason?: 'ignored' | 'snapshot' | null;
  max_age_seconds?: number;
  /** Sinds agent 1.2.1: "timer" = systemd-timer (laatste run en resultaat), anders een map. */
  source?: 'timer' | 'dir';
  result?: string | null;
  description?: string;
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
  /** Sinds agent 1.2.3: de installknop neemt dit pakket niet mee (zie reason). */
  held?: boolean;
  reason?: 'removal' | 'phased' | 'hold' | 'other' | null;
}

export interface UpdatesState {
  checked_at: number | null;
  count: number;
  security_count: number;
  /** Sinds agent 1.2.3: count = installeerbaar; held_count = tegengehouden. */
  held_count?: number;
  /** Wat `sudo apt full-upgrade` zou verwijderen om de tegengehouden pakketten bij te werken. */
  full_upgrade_removes?: string[];
  packages: AptPackage[];
  reboot_required: boolean;
  error: string | null;
  allowed: boolean;
  checking: boolean;
  upgrade: UnitRun;
  blocked_reason: string | null;
  /** Sinds agent 1.2.1: samenvatting van de laatste installatie. kept_back = wat nog openstaat omdat het iets zou verwijderen. */
  last_upgrade?: { at: number | null; rc: number | null; upgraded: number | null; newly_installed: number | null; not_upgraded: number | null; kept_back: string[] } | null;
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
