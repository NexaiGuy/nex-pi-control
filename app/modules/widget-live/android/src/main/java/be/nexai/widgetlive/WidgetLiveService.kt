package be.nexai.widgetlive

import android.app.AppOpsManager
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProviderInfo
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.util.Log

/**
 * Live widgets: houdt de widgets van Nex Pi Control vers zolang je ernaar kijkt.
 *
 * Android ververst widgets uit zichzelf hooguit om de 30 minuten. Deze dienst vraagt elke widget opnieuw te tekenen
 * (dezelfde WIDGET_UPDATE als Android zelf stuurt, dus dezelfde headless taak in src/widget/task.tsx):
 *
 * - meteen als je je gsm ontgrendelt of terugkeert naar je startscherm (tenzij de laatste verversing net gebeurde);
 * - daarna elke [interval] seconden zolang je op je startscherm blijft.
 *
 * Wanneer kijk je? Scherm aan, gsm ontgrendeld, Nex Pi Control zelf niet open (die werkt de widgets al bij) en, met
 * "Toegang tot gebruiksgegevens", het startscherm vooraan. Zonder die toegang weten we niet welke app vooraan staat:
 * dan verversen we zolang de gsm ontgrendeld is. Scherm uit of vergrendeld: niets, geen netwerk, geen batterij.
 *
 * Draait als voorgrondservice (type specialUse) met een stille melding, anders stopt Android hem na een minuut.
 */
class WidgetLiveService : Service() {
  companion object {
    private const val CHANNEL = "widget_live"
    private const val NOTIF_ID = 4208
    private const val ACTION_STOP = "be.nexai.widgetlive.STOP"
    private const val PREFS = "widget_live"
    private const val TAG = "WidgetLive"

    const val DEFAULT_INTERVAL_S = 60
    private const val MIN_INTERVAL_S = 15
    private const val MAX_INTERVAL_S = 900

    /** Hoe vaak we kijken of je nog op je startscherm bent (ms). Lezen van gebruiksgegevens, geen netwerk. */
    private const val TICK_MS = 2_000L

    /** Terug op je startscherm: verversen, tenzij de vorige verversing jonger is dan dit (ms). */
    private const val ARRIVE_MS = 10_000L

    /** Startschermen op naam, voor toestellen waar Android ze niet (allemaal) teruggeeft. */
    private val KNOWN_HOMES = setOf(
      "com.sec.android.app.launcher", // Samsung One UI Home
      "com.google.android.apps.nexuslauncher", // Pixel
      "com.android.launcher3",
      "com.miui.home",
      "com.huawei.android.launcher",
      "com.oppo.launcher",
      "com.motorola.launcher3",
      "com.teslacoilsw.launcher", // Nova
    )

    @Volatile
    private var instance: WidgetLiveService? = null

    /** Staat de app zelf op het scherm? Dan doet de app het werk. Gezet door WidgetLiveModule. */
    @Volatile
    private var appVisible = false

    private val main = Handler(Looper.getMainLooper())

    val running: Boolean
      get() = instance != null

    fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Staat de service in het manifest (plugins/withWidgetLive.js met enabled: true)? */
    fun isDeclared(ctx: Context): Boolean =
      try {
        ctx.packageManager.getServiceInfo(ComponentName(ctx, WidgetLiveService::class.java), 0)
        true
      } catch (e: PackageManager.NameNotFoundException) {
        false
      }

    fun isEnabled(ctx: Context): Boolean = prefs(ctx).getBoolean("enabled", false)

    fun interval(ctx: Context): Int =
      prefs(ctx).getInt("interval_s", DEFAULT_INTERVAL_S).coerceIn(MIN_INTERVAL_S, MAX_INTERVAL_S)

    fun setInterval(ctx: Context, seconds: Int) {
      prefs(ctx).edit().putInt("interval_s", seconds.coerceIn(MIN_INTERVAL_S, MAX_INTERVAL_S)).apply()
      main.post { instance?.evaluate() }
    }

    /** "Toegang tot gebruiksgegevens": nodig om te weten of je op je startscherm bent of in een andere app. */
    fun usageAccess(ctx: Context): Boolean =
      try {
        val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        @Suppress("DEPRECATION")
        val mode =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
          } else {
            ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
          }
        mode == AppOpsManager.MODE_ALLOWED
      } catch (e: Exception) {
        false
      }

    /**
     * Aanzetten vanuit de app. Labels zijn de teksten van de melding in de taal van de app ("title", "text",
     * "stop", "channel"). Draait hij al, dan krijgt de melding enkel de nieuwe tekst.
     */
    fun enable(ctx: Context, labels: Map<String, String>): Boolean {
      if (!isDeclared(ctx)) return false
      val e = prefs(ctx).edit().putBoolean("enabled", true)
      for ((k, v) in labels) {
        if (k in setOf("title", "text", "stop", "channel")) e.putString("label_$k", v.take(80))
      }
      e.apply()
      val svc = instance
      if (svc != null) {
        main.post {
          svc.notifyLabels()
          svc.evaluate()
        }
        return true
      }
      return start(ctx)
    }

    /** Start de dienst als hij aan staat (na het openen van de app of na een herstart van de gsm). */
    fun start(ctx: Context): Boolean {
      if (!isDeclared(ctx) || !isEnabled(ctx)) return false
      if (instance != null) return true
      return try {
        val i = Intent(ctx, WidgetLiveService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
        true
      } catch (e: Exception) {
        // Android 12+ weigert een voorgrondservice die vanuit de achtergrond start: bij het openen van de app lukt het.
        Log.w(TAG, "starten geweigerd: ${e.message}")
        false
      }
    }

    fun disable(ctx: Context) {
      prefs(ctx).edit().putBoolean("enabled", false).apply()
      ctx.stopService(Intent(ctx, WidgetLiveService::class.java))
    }

    fun setAppVisible(visible: Boolean) {
      appVisible = visible
      main.post { instance?.evaluate() }
    }

    private fun providers(ctx: Context, mgr: AppWidgetManager): List<AppWidgetProviderInfo> =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        mgr.getInstalledProvidersForPackage(ctx.packageName, null)
      } else {
        mgr.installedProviders.filter { it.provider.packageName == ctx.packageName }
      }

    /** Aantal widgets van deze app op het startscherm. */
    fun widgetCount(ctx: Context): Int =
      try {
        val mgr = AppWidgetManager.getInstance(ctx)
        providers(ctx, mgr).sumOf { mgr.getAppWidgetIds(it.provider).size }
      } catch (e: Exception) {
        0
      }

    /**
     * Vraagt elke widget van deze app opnieuw te tekenen, met dezelfde APPWIDGET_UPDATE die Android om de 30 minuten
     * stuurt. Enkel naar onze eigen ontvangers (expliciete component). Geeft het aantal widgets terug.
     */
    fun requestUpdate(ctx: Context): Int {
      var n = 0
      try {
        val mgr = AppWidgetManager.getInstance(ctx)
        for (p in providers(ctx, mgr)) {
          val ids = mgr.getAppWidgetIds(p.provider)
          if (ids.isEmpty()) continue
          n += ids.size
          val i = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
            .setComponent(p.provider)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
          ctx.sendBroadcast(i)
        }
      } catch (e: Exception) {
        Log.w(TAG, "verversen mislukt: ${e.message}")
      }
      return n
    }

    /** Voor de statusregel in Instellingen. */
    fun status(ctx: Context): Map<String, Any?> {
      val svc = instance
      val last = svc?.lastRefreshWall ?: 0L
      return mapOf(
        "running" to (svc != null),
        "enabled" to isEnabled(ctx),
        "intervalS" to interval(ctx),
        "usageAccess" to usageAccess(ctx),
        "widgets" to widgetCount(ctx),
        "looking" to (svc?.looking == true),
        "onHome" to svc?.onHomeNow,
        "lastRefresh" to (if (last > 0) last.toDouble() else null),
      )
    }
  }

  private var receiverRegistered = false
  private var screenOn = true
  private var ticking = false

  /** Kijk je nu (scherm aan, ontgrendeld, app dicht)? En sta je op je startscherm? Voor de statusregel. */
  @Volatile
  private var looking = false

  @Volatile
  private var onHomeNow: Boolean? = null

  /** Laatste verversing: monotone klok voor de planning, wandklok voor de statusregel. */
  private var lastRefresh = 0L

  @Volatile
  private var lastRefreshWall = 0L

  /** Stond je bij de vorige ronde op je startscherm? Zo herkennen we een terugkeer. */
  private var wasHome = false

  private var launchers: Set<String> = emptySet()
  private var foreground: String? = null
  private var lastEventAt = 0L

  private val tick = object : Runnable {
    override fun run() {
      if (!ticking) return
      step()
      if (ticking) main.postDelayed(this, TICK_MS)
    }
  }

  private val screenReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        Intent.ACTION_SCREEN_OFF -> screenOn = false
        Intent.ACTION_SCREEN_ON, Intent.ACTION_USER_PRESENT -> screenOn = true
      }
      // Ontgrendeld of scherm aan: telt als een nieuwe blik, dus als terugkeer naar het startscherm.
      if (intent.action != Intent.ACTION_SCREEN_OFF) wasHome = false
      evaluate()
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    // Altijd eerst startForeground: anders stopt Android de app als hij via startForegroundService kwam.
    if (!startInForeground() || !isEnabled(this)) {
      stopSelf()
      return
    }
    instance = this
    launchers = findLaunchers()
    screenOn = (getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_ON)
      addAction(Intent.ACTION_SCREEN_OFF)
      addAction(Intent.ACTION_USER_PRESENT)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(screenReceiver, filter)
    }
    receiverRegistered = true
    Log.d(TAG, "gestart: elke ${interval(this)} s, startschermen: $launchers, gebruiksgegevens: ${usageAccess(this)}")
    evaluate()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      // "Uitzetten" in de melding: blijvend, net als de schakelaar in Instellingen.
      prefs(this).edit().putBoolean("enabled", false).apply()
      stopSelf()
      return START_NOT_STICKY
    }
    return START_STICKY
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    ticking = false
    looking = false
    main.removeCallbacks(tick)
    if (receiverRegistered) {
      try {
        unregisterReceiver(screenReceiver)
      } catch (e: Exception) {
        // al afgemeld
      }
      receiverRegistered = false
    }
    super.onDestroy()
  }

  // --- Melding ----------------------------------------------------------------------------------------

  private fun label(key: String, fallback: String): String = prefs(this).getString("label_$key", null) ?: fallback

  private fun buildNotification(): Notification {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val ch = NotificationChannel(CHANNEL, label("channel", "Live widgets"), NotificationManager.IMPORTANCE_MIN)
      ch.setShowBadge(false)
      nm.createNotificationChannel(ch)
    }
    val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    }
    val open = launch?.let { PendingIntent.getActivity(this, 10, it, flags) }
    val stop = PendingIntent.getService(this, 11, Intent(this, WidgetLiveService::class.java).setAction(ACTION_STOP), flags)
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, CHANNEL)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(this)
      }
    builder
      .setSmallIcon(R.drawable.widget_live_notification)
      .setContentTitle(label("title", "Nex Pi Control"))
      .setContentText(label("text", "Live widgets are on"))
      .setOngoing(true)
      .setShowWhen(false)
      .addAction(Notification.Action.Builder(null as Icon?, label("stop", "Turn off"), stop).build())
    if (open != null) builder.setContentIntent(open)
    return builder.build()
  }

  /** false: Android weigerde (bv. een herstart vanuit de achtergrond). Bij het openen van de app start hij opnieuw. */
  private fun startInForeground(): Boolean =
    try {
      val n = buildNotification()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
      } else {
        startForeground(NOTIF_ID, n)
      }
      true
    } catch (e: Exception) {
      Log.w(TAG, "voorgrond geweigerd: ${e.message}")
      false
    }

  /** Nieuwe tekst in de melding (andere taal of ander interval). */
  internal fun notifyLabels() {
    try {
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIF_ID, buildNotification())
    } catch (e: Exception) {
      // geen meldingsrecht: de dienst draait gewoon verder
    }
  }

  // --- Kijken en verversen ----------------------------------------------------------------------------

  private fun unlocked(): Boolean =
    try {
      !(getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
    } catch (e: Exception) {
      true
    }

  /** Bepaalt of we moeten kijken, en start of stopt de ronde. Goedkoop: geen netwerk. */
  internal fun evaluate() {
    val need = screenOn && !appVisible && unlocked()
    looking = need
    if (need && !ticking) {
      ticking = true
      main.post(tick)
    } else if (!need && ticking) {
      ticking = false
      main.removeCallbacks(tick)
    }
    if (!need) {
      wasHome = false
      onHomeNow = null
    }
  }

  /** Eén ronde: sta je op je startscherm, en is het tijd om te verversen? */
  private fun step() {
    // Het scherm kan vergrendeld zijn zonder dat we dat hoorden (bv. scherm aan via een melding): opnieuw nagaan.
    if (!unlocked() || appVisible || !screenOn) {
      evaluate()
      return
    }
    val usage = usageAccess(this)
    if (usage) pollForeground() else foreground = null
    val home = !usage || onHomeScreen()
    onHomeNow = if (usage) home else null
    if (!home) {
      wasHome = false
      return
    }
    val now = SystemClock.elapsedRealtime()
    val since = now - lastRefresh
    val due = lastRefresh == 0L || since >= interval(this) * 1000L || (!wasHome && since >= ARRIVE_MS)
    wasHome = true
    if (!due) return
    lastRefresh = now
    lastRefreshWall = System.currentTimeMillis()
    val n = requestUpdate(this)
    Log.d(TAG, "ververst: $n widget(s)")
  }

  /**
   * Op het startscherm? Ruim gemeten, zoals bij het zwevende icoon: elk startscherm dat Android kent, de bekende
   * launchers op naam, en Nex Pi Control zelf (net verlaten). Onbekend = startscherm.
   */
  private fun onHomeScreen(): Boolean {
    val fg = foreground ?: return true
    return launchers.isEmpty() || fg in launchers || fg in KNOWN_HOMES || fg == packageName
  }

  private fun findLaunchers(): Set<String> {
    val found = mutableSetOf<String>()
    try {
      val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
      @Suppress("DEPRECATION")
      val list = packageManager.queryIntentActivities(i, 0)
      for (r in list) {
        val pkg = r.activityInfo?.packageName ?: continue
        if (pkg != packageName && pkg != "android") found.add(pkg)
      }
    } catch (e: Exception) {
      // geen lijst: dan telt elke app als startscherm
    }
    return found
  }

  /** Leest de laatste "naar voorgrond"-gebeurtenis sinds de vorige keer. Enkel lezen, niets wordt bewaard. */
  private fun pollForeground() {
    try {
      val usm = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
      val now = System.currentTimeMillis()
      val from = if (lastEventAt > 0) lastEventAt else now - 10 * 60_000
      val events = usm.queryEvents(from, now) ?: return
      val e = UsageEvents.Event()
      while (events.hasNextEvent()) {
        events.getNextEvent(e)
        @Suppress("DEPRECATION")
        if (e.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) foreground = e.packageName
        if (e.timeStamp > lastEventAt) lastEventAt = e.timeStamp
      }
    } catch (e: Exception) {
      // geen toegang (meer): step() valt terug op "ontgrendeld = kijken"
    }
  }
}
