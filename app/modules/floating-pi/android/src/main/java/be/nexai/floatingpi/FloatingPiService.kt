package be.nexai.floatingpi

import android.Manifest
import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.TimeInterpolator
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.app.ActivityOptions
import android.app.AppOpsManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.PixelFormat
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Process
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.VelocityTracker
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import kotlin.math.hypot

/**
 * Zwevend icoon: de draaiende Pi-behuizing boven andere apps (zoals een chat-bubbel).
 *
 * - Tik: opent Nex Pi Control.
 * - Slepen: overal op het scherm neer te zetten, hij blijft waar je hem loslaat. Gooien laat hem nog even doorglijden.
 * - Naar het kruis onderaan slepen: het kruis trekt hem magnetisch aan, loslaten verbergt hem tot je de app weer opent.
 *   Echt uitzetten (blijvend) gebeurt enkel met de schakelaar in Instellingen (FloatingPiModule.stop).
 * - Blijft altijd volledig zichtbaar, verschijnt met een kleine veer, krimpt even als je hem indrukt.
 * - Standaard enkel op je startscherm: open je een andere app, dan wacht hij op de achtergrond tot je terug op je
 *   startscherm bent (via "Toegang tot gebruiksgegevens"; zonder die toegang zweeft hij overal).
 * - Bank- en betaalapps (BankApps.PREFIXES) vooraan: het venster gaat helemaal weg en komt vanzelf terug als je de
 *   bank-app verlaat. Ook als "enkel op het startscherm" uit staat.
 * - Verborgen zolang de app zelf open is, gepauzeerd als het scherm uit staat (geen batterijverbruik).
 * - Een ruitje toont de status van de actieve Pi (amber, rood, grijs), gezet door de app en de achtergrondtaak.
 *
 * Draait als voorgrondservice (type specialUse) met een stille melding, anders sluit Android hem na een minuut.
 */
class FloatingPiService : Service() {
  companion object {
    private const val CHANNEL = "floating_pi"
    private const val NOTIF_ID = 4207
    private const val ACTION_STOP = "be.nexai.floatingpi.STOP"
    private const val PREFS = "floating_pi"
    private const val SIZE_DP = 60
    private const val EDGE_DP = 4

    /** Vanaf deze snelheid (px/s) telt loslaten als gooien: de bubbel glijdt nog even door. */
    private const val FLING_PX_S = 900f

    private const val TAG = "FloatingPi"

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

    /**
     * Hoe vaak we kijken welke app op de voorgrond staat (ms).
     *
     * Waarom 700: zo kort ligt ons venster hooguit boven een bank-app die net opent, voor we het weghalen.
     * Korter kost merkbaar meer batterij (elke ronde is een query naar UsageStatsManager), langer laat KBC te lang
     * een overlay zien. We pollen enkel met het scherm aan en Nex Pi Control dicht.
     */
    private const val WATCH_MS = 700L

    /** Hoe ver hij doorglijdt: snelheid x deze tijd (s). */
    private const val GLIDE_S = 0.12f

    @Volatile
    private var instance: FloatingPiService? = null

    /** Staat de app zelf op het scherm? Dan verbergen we de bubbel. Gezet door FloatingPiModule. */
    @Volatile
    private var appVisible = false

    private val main = Handler(Looper.getMainLooper())

    /** Geest-animaties in een raster van 5 x 5 (kolom, rij): de dichtstbijzijnde bij het icoon wordt gebruikt. */
    private val GENIE = arrayOf(
      intArrayOf(R.anim.floating_pi_genie_11, R.anim.floating_pi_genie_12, R.anim.floating_pi_genie_13, R.anim.floating_pi_genie_14, R.anim.floating_pi_genie_15),
      intArrayOf(R.anim.floating_pi_genie_21, R.anim.floating_pi_genie_22, R.anim.floating_pi_genie_23, R.anim.floating_pi_genie_24, R.anim.floating_pi_genie_25),
      intArrayOf(R.anim.floating_pi_genie_31, R.anim.floating_pi_genie_32, R.anim.floating_pi_genie_33, R.anim.floating_pi_genie_34, R.anim.floating_pi_genie_35),
      intArrayOf(R.anim.floating_pi_genie_41, R.anim.floating_pi_genie_42, R.anim.floating_pi_genie_43, R.anim.floating_pi_genie_44, R.anim.floating_pi_genie_45),
      intArrayOf(R.anim.floating_pi_genie_51, R.anim.floating_pi_genie_52, R.anim.floating_pi_genie_53, R.anim.floating_pi_genie_54, R.anim.floating_pi_genie_55),
    )

    val running: Boolean
      get() = instance != null

    fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Staat de service met de juiste rechten in het manifest (plugins/withFloatingIcon.js)? */
    fun isDeclared(ctx: Context): Boolean =
      try {
        @Suppress("DEPRECATION")
        val info = ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_PERMISSIONS)
        info.requestedPermissions?.contains(Manifest.permission.SYSTEM_ALERT_WINDOW) == true
      } catch (e: Exception) {
        false
      }

    fun canDraw(ctx: Context): Boolean = Settings.canDrawOverlays(ctx)

    /** "Toegang tot gebruiksgegevens": nodig om te weten of je op je startscherm bent of in een andere app. */
    fun usageAccess(ctx: Context): Boolean =
      try {
        val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        // Android wisselde de aanbevolen naam een paar keer (checkOpNoThrow / unsafeCheckOpNoThrow); beide werken.
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

    /** Enkel op het startscherm tonen (standaard), of boven alle apps. */
    fun homeOnly(ctx: Context): Boolean = prefs(ctx).getBoolean("home_only", true)

    fun setHomeOnly(ctx: Context, value: Boolean) {
      prefs(ctx).edit().putBoolean("home_only", value).apply()
      main.post { instance?.refresh() }
    }

    /** Voor de statusregel in Instellingen: draait de dienst, welke app staat vooraan, is dat het startscherm? */
    fun status(ctx: Context): Map<String, Any?> {
      val svc = instance
      return mapOf(
        "running" to (svc != null),
        "enabled" to prefs(ctx).getBoolean("enabled", false),
        "canDraw" to canDraw(ctx),
        "usageAccess" to usageAccess(ctx),
        "homeOnly" to homeOnly(ctx),
        "foreground" to svc?.foreground,
        "onHome" to svc?.onHomeScreen(),
        "visible" to (svc?.attached == true),
        "bank" to (svc?.bankInFront() == true),
      )
    }

    /** Na het geven van een toestemming: meteen opnieuw bekijken wat zichtbaar moet zijn. */
    fun recheck() {
      main.post { instance?.refresh() }
    }

    /** Aanzetten vanuit de app (voorgrond). Labels zijn de teksten van de melding in de taal van de app. */
    fun enable(ctx: Context, labels: Map<String, String>): Boolean {
      if (!isDeclared(ctx) || !canDraw(ctx)) return false
      val e = prefs(ctx).edit().putBoolean("enabled", true)
      for ((k, v) in labels) {
        if (k in setOf("title", "text", "hide", "channel")) e.putString("label_$k", v.take(80))
      }
      e.apply()
      // Aanzetten gebeurt altijd vanuit de open app: tot je ze verlaat blijft de bubbel verborgen.
      appVisible = true
      if (instance == null) {
        val i = Intent(ctx, FloatingPiService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
      }
      return true
    }

    fun disable(ctx: Context) {
      prefs(ctx).edit().putBoolean("enabled", false).apply()
      ctx.stopService(Intent(ctx, FloatingPiService::class.java))
    }

    fun setAppVisible(visible: Boolean) {
      appVisible = visible
      main.post { instance?.refresh() }
    }

    /** "ok", "warning", "critical", "offline" of "unknown". */
    fun setStatus(ctx: Context, level: String) {
      prefs(ctx).edit().putString("status", level).apply()
      main.post { instance?.applyStatus(level) }
    }

    private fun statusColor(level: String?): Int =
      when (level) {
        "critical" -> 0xFFFF2A1F.toInt()
        "warning" -> 0xFFFFB020.toInt()
        "offline" -> 0xFF8A8A94.toInt()
        else -> 0
      }
  }

  private lateinit var wm: WindowManager
  private var sheet: Bitmap? = null
  private var bubble: BubbleView? = null
  private var attached = false
  private var close: CloseTargetView? = null
  private lateinit var lp: WindowManager.LayoutParams
  private var move: ValueAnimator? = null
  private var velocity: VelocityTracker? = null
  private var magnet = false
  private var screenOn = true
  private var receiverRegistered = false

  /** Pakketten van de startschermen (launchers) op dit toestel, en de app die nu op de voorgrond staat. */
  private var launchers: Set<String> = emptySet()
  private var foreground: String? = null
  private var lastEventAt = 0L
  private var watching = false

  /** De bank-app waarvoor we het venster weghaalden, enkel voor de log bij terugkeer (adb logcat -s FloatingPi). */
  private var lastBank: String? = null

  /** Kijkt elke 0,7 s welke app op de voorgrond staat, enkel zolang het nodig is (scherm aan, app dicht). */
  private val watch = object : Runnable {
    override fun run() {
      if (!watching) return
      pollForeground()
      refresh()
      if (watching) main.postDelayed(this, WATCH_MS)
    }
  }

  private val screenReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      screenOn = intent.action != Intent.ACTION_SCREEN_OFF
      refresh()
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    // Altijd eerst startForeground: anders stopt Android de app als hij via startForegroundService kwam.
    startInForeground()
    if (!canDraw(this)) {
      prefs(this).edit().putBoolean("enabled", false).apply()
      stopSelf()
      return
    }
    instance = this
    launchers = findLaunchers()
    Log.d(TAG, "startschermen: $launchers, enkel startscherm: ${homeOnly(this)}, gebruiksgegevens: ${usageAccess(this)}")
    wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    addBubble()
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_ON)
      addAction(Intent.ACTION_SCREEN_OFF)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(screenReceiver, filter)
    }
    receiverRegistered = true
    applyStatus(prefs(this).getString("status", null))
    // Toont hem meteen (met de veer) als dat moet, ook na een herstart door Android terwijl de app dicht is.
    refresh()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      // Tijdelijk: bij het openen van de app komt hij terug. Echt uitzetten doe je in Instellingen.
      stopSelf()
      return START_NOT_STICKY
    }
    return START_STICKY
  }

  override fun onDestroy() {
    instance = null
    watching = false
    main.removeCallbacks(watch)
    move?.cancel()
    velocity?.recycle()
    velocity = null
    bubble?.pause()
    if (attached) bubble?.let { removeSafely(it) }
    attached = false
    close?.let { removeSafely(it) }
    bubble = null
    close = null
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

  private fun launchIntent(): Intent? =
    packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    }

  private fun startInForeground() {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val ch = NotificationChannel(CHANNEL, label("channel", "Floating icon"), NotificationManager.IMPORTANCE_MIN)
      ch.setShowBadge(false)
      nm.createNotificationChannel(ch)
    }
    val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    val open = launchIntent()?.let { PendingIntent.getActivity(this, 0, it, flags) }
    val stop = PendingIntent.getService(this, 2, Intent(this, FloatingPiService::class.java).setAction(ACTION_STOP), flags)
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, CHANNEL)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(this)
      }
    builder
      .setSmallIcon(R.drawable.floating_pi_notification)
      .setContentTitle(label("title", "Nex Pi Control"))
      .setContentText(label("text", "Floating icon is on"))
      .setOngoing(true)
      .setShowWhen(false)
      .addAction(Notification.Action.Builder(null as Icon?, label("hide", "Hide"), stop).build())
    if (open != null) builder.setContentIntent(open)
    val n = builder.build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIF_ID, n)
    }
  }

  // --- Bubbel -----------------------------------------------------------------------------------------

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

  private fun overlayType(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

  private fun screenW(): Int = resources.displayMetrics.widthPixels

  private fun screenH(): Int = resources.displayMetrics.heightPixels

  private fun motionAllowed(): Boolean =
    try {
      Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f
    } catch (e: Exception) {
      true
    }

  @SuppressLint("ClickableViewAccessibility")
  private fun addBubble() {
    val opts = BitmapFactory.Options().apply { inScaled = false }
    val bmp = BitmapFactory.decodeResource(resources, R.drawable.floating_pi_sheet, opts) ?: return
    sheet = bmp
    val size = dp(SIZE_DP)
    val p = prefs(this)
    lp = WindowManager.LayoutParams(
      size,
      size,
      overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = p.getInt("x", screenW() - size - dp(EDGE_DP)).coerceIn(minX(), maxX(size))
      y = p.getInt("y", (screenH() * 0.3f).toInt()).coerceIn(minY(), maxY(size))
    }
    val v = BubbleView(this, bmp)
    v.contentDescription = label("title", "Nex Pi Control")
    v.setOnClickListener {
      it.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
      openApp()
    }
    val slop = ViewConfiguration.get(this).scaledTouchSlop.toFloat()
    var downX = 0f
    var downY = 0f
    var startX = 0
    var startY = 0
    var dragging = false
    var downAt = 0L
    v.setOnTouchListener { view, e ->
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          move?.cancel()
          wake()
          press(view, true)
          velocity?.recycle()
          velocity = VelocityTracker.obtain().also { it.addMovement(e) }
          downX = e.rawX
          downY = e.rawY
          startX = lp.x
          startY = lp.y
          dragging = false
          downAt = e.eventTime
        }
        MotionEvent.ACTION_MOVE -> {
          velocity?.addMovement(e)
          val dx = e.rawX - downX
          val dy = e.rawY - downY
          if (!dragging && hypot(dx, dy) > slop) {
            dragging = true
            showClose()
          }
          if (dragging) {
            val near = nearClose(e.rawX, e.rawY)
            if (near != magnet) {
              magnet = near
              close?.active = near
              view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
            }
            if (near) {
              // Magneet: de bubbel klikt vast in het midden van het kruis.
              lp.x = screenW() / 2 - lp.width / 2
              lp.y = closeCenterY() - lp.height / 2
            } else {
              lp.x = (startX + dx).toInt().coerceIn(minX(), maxX(lp.width))
              lp.y = (startY + dy).toInt().coerceIn(minY(), maxY(lp.height))
            }
            updateSafely(view, lp)
          }
        }
        MotionEvent.ACTION_UP -> {
          press(view, false)
          val vt = velocity
          var vx = 0f
          var vy = 0f
          if (vt != null) {
            vt.addMovement(e)
            vt.computeCurrentVelocity(1000)
            vx = vt.xVelocity
            vy = vt.yVelocity
            vt.recycle()
          }
          velocity = null
          if (dragging) {
            if (magnet) {
              dismiss(view)
            } else {
              hideClose()
              settle(vx, vy)
            }
          } else if (e.eventTime - downAt < 500) {
            view.performClick()
          }
        }
        MotionEvent.ACTION_CANCEL -> {
          press(view, false)
          velocity?.recycle()
          velocity = null
          if (dragging) {
            hideClose()
            settle(0f, 0f)
          }
        }
      }
      true
    }
    bubble = v
    // Nog niet aan het scherm hangen: refresh() doet dat enkel als hij echt zichtbaar moet zijn.
  }

  /**
   * Het venster bestaat enkel zolang de bubbel zichtbaar is. Verborgen = venster helemaal weg, zodat er boven een andere
   * app (zoals je bank-app) niets van Nex Pi Control ligt: geen tapjacking-alarm, en ook Androids melding
   * "... wordt weergegeven over andere apps" verdwijnt dan.
   *
   * Waarom removeView en niet setVisibility(View.GONE): met GONE blijft het venster bij WindowManager geregistreerd als
   * TYPE_APPLICATION_OVERLAY (het staat nog in "adb shell dumpsys window windows" en Android blijft melden dat de app
   * over andere apps tekent). Bij Xplain hielp enkel het venster echt weghalen. Een venster dat niet bestaat, kan een
   * bank-app ook niet opmerken.
   */
  private fun attach(): Boolean {
    val v = bubble ?: return false
    if (attached) return true
    return try {
      wm.addView(v, lp)
      attached = true
      true
    } catch (e: Exception) {
      false
    }
  }

  private fun detach() {
    if (!attached) return
    move?.cancel()
    hideClose()
    bubble?.let { removeSafely(it) }
    attached = false
  }

  /**
   * Opent de app met een geest-effect: de app komt als een smalle straal uit het icoon en vouwt dan open
   * (res/anim/floating_pi_genie_*). 25 varianten in een raster over het scherm, de dichtstbijzijnde bij het icoon wint.
   * Met "animaties uit" in Android gewoon zonder effect.
   */
  private fun openApp() {
    val i = launchIntent() ?: return
    val opts =
      if (motionAllowed()) {
        val fx = ((lp.x + lp.width / 2f) / screenW()).coerceIn(0f, 1f)
        val fy = ((lp.y + lp.height / 2f) / screenH()).coerceIn(0f, 1f)
        val col = ((fx - 0.1f) / 0.2f + 0.5f).toInt().coerceIn(0, 4)
        val row = ((fy - 0.1f) / 0.2f + 0.5f).toInt().coerceIn(0, 4)
        val enter = GENIE[col][row]
        // De bubbel verdwijnt in de app die eruit komt.
        bubble?.animate()?.alpha(0f)?.scaleX(0.4f)?.scaleY(0.4f)?.setDuration(160L)?.start()
        ActivityOptions.makeCustomAnimation(this, enter, R.anim.floating_pi_hold)
      } else {
        ActivityOptions.makeBasic()
      }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        // Vanaf Android 14 moet een start vanuit de achtergrond dat expliciet vragen (de bubbel is zichtbaar, dus toegestaan).
        @Suppress("DEPRECATION")
        opts.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
        val pi = PendingIntent.getActivity(this, 1, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        pi.send(this, 0, null, null, null, null, opts.toBundle())
      } else {
        startActivity(i, opts.toBundle())
      }
    } catch (e: Exception) {
      try {
        startActivity(i)
      } catch (ignored: Exception) {
        // niets aan te doen
      }
    }
  }

  // --- Gedrag zoals de meeste zwevende iconen (chat-bubbels, zwevende knoppen) ---------------------------

  // Overal op het scherm, enkel binnen de randen (zodat hij nooit half buiten beeld verdwijnt).
  private fun minX(): Int = 0

  private fun maxX(size: Int): Int = maxOf(minX(), screenW() - size)

  private fun minY(): Int = 0

  private fun maxY(size: Int): Int = maxOf(minY(), screenH() - size)

  private fun closeCenterY(): Int = screenH() - dp(96)

  /** Vingerpositie dicht bij het kruis onderaan? Ruim gemeten, zodat het magnetisch aanvoelt. */
  private fun nearClose(rawX: Float, rawY: Float): Boolean = hypot(rawX - screenW() / 2f, rawY - closeCenterY()) < dp(88)

  /** Indrukken: iets kleiner, loslaten: veert terug. */
  private fun press(view: View, down: Boolean) {
    val s = if (down) 0.9f else 1f
    view.animate().scaleX(s).scaleY(s).setDuration(if (down) 90L else 220L)
      .setInterpolator(if (down) DecelerateInterpolator() else OvershootInterpolator(2.5f)).start()
  }

  /** Altijd volledig zichtbaar: hij wordt nooit donkerder of doorzichtig na een tijdje. */
  private fun wake() {
    bubble?.animate()?.alpha(1f)?.setDuration(120L)?.start()
  }

  /** Verschijnen met een kleine veer (bij het starten en telkens je de app verlaat). */
  private fun popIn() {
    val b = bubble ?: return
    b.alpha = 1f
    b.scaleX = 0.2f
    b.scaleY = 0.2f
    b.animate().scaleX(1f).scaleY(1f).setDuration(320L).setInterpolator(OvershootInterpolator(2f)).start()
  }

  /**
   * Loslaten: hij blijft staan waar je hem neerzet, overal op het scherm. Gooi je hem, dan glijdt hij nog een stukje
   * door in die richting en remt zacht af. De plek wordt bewaard.
   */
  private fun settle(vx: Float, vy: Float) {
    val glide = if (hypot(vx, vy) > FLING_PX_S) GLIDE_S else 0f
    val tx = (lp.x + vx * glide).toInt().coerceIn(minX(), maxX(lp.width))
    val ty = (lp.y + vy * glide).toInt().coerceIn(minY(), maxY(lp.height))
    val save = {
      prefs(this).edit().putInt("x", lp.x).putInt("y", lp.y).apply()
    }
    if (tx == lp.x && ty == lp.y) {
      save()
      return
    }
    animateTo(tx, ty, 320L, DecelerateInterpolator(1.6f), save)
  }

  private fun animateTo(tx: Int, ty: Int, ms: Long, interp: TimeInterpolator, done: () -> Unit) {
    val fx = lp.x
    val fy = lp.y
    move?.cancel()
    move = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = ms
      interpolator = interp
      addUpdateListener { a ->
        val f = a.animatedValue as Float
        lp.x = (fx + (tx - fx) * f).toInt()
        lp.y = (fy + (ty - fy) * f).toInt()
        bubble?.let { updateSafely(it, lp) }
      }
      addListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) {
          done()
        }
      })
      start()
    }
  }

  /** In het kruis gelaten: krimpen en weg, tot je de app weer opent (de keuze in Instellingen blijft aan). */
  private fun dismiss(view: View) {
    view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
    view.animate().scaleX(0f).scaleY(0f).alpha(0f).setDuration(180L).setInterpolator(DecelerateInterpolator()).start()
    close?.animate()?.alpha(0f)?.setDuration(180L)?.start()
    main.postDelayed({ stopSelf() }, 200L)
  }

  private fun showClose() {
    if (close != null) return
    val v = CloseTargetView(this)
    val clp = WindowManager.LayoutParams(
      dp(72),
      dp(72),
      overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = screenW() / 2 - dp(36)
      y = closeCenterY() - dp(36)
    }
    try {
      v.alpha = 0f
      v.scaleX = 0.6f
      v.scaleY = 0.6f
      wm.addView(v, clp)
      v.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(180L).setInterpolator(DecelerateInterpolator()).start()
      close = v
    } catch (e: Exception) {
      close = null
    }
  }

  private fun hideClose() {
    magnet = false
    close?.let { removeSafely(it) }
    close = null
  }

  private fun updateSafely(v: View, p: WindowManager.LayoutParams) {
    try {
      wm.updateViewLayout(v, p)
    } catch (e: Exception) {
      // view niet (meer) gekoppeld
    }
  }

  private fun removeSafely(v: View) {
    try {
      wm.removeView(v)
    } catch (e: Exception) {
      // al weg
    }
  }

  private fun applyStatus(level: String?) {
    bubble?.statusColor = statusColor(level)
  }

  /**
   * Zichtbaar en draaiend enkel als het scherm aan is, de app zelf niet open staat, er geen bank-app vooraan staat en
   * (met "enkel op het startscherm") je startscherm op de voorgrond staat. De regel zelf staat in
   * BankApps.bubbleVisible, zodat BankAppsTest precies dit gedrag vastlegt.
   *
   * Zonder "Toegang tot gebruiksgegevens" weten we niet wat vooraan staat: dan tonen we hem (onbekend = blijven).
   */
  private fun refresh() {
    val b = bubble ?: return
    val usage = usageAccess(this)
    val home = homeOnly(this) && usage
    // Zonder toegang negeren we een oude meting: anders zou een KBC van daarnet de bubbel voor altijd verbergen.
    val fg = if (usage) foreground else null
    val show = BankApps.bubbleVisible(appVisible, home, onHomeScreen(), fg)
    if (show && !attached) {
      if (attach()) {
        popIn()
        if (BankApps.isBankApp(lastBank)) Log.d(TAG, "bank-app weg ($fg): venster terug")
        lastBank = null
      }
    } else if (!show && attached) {
      b.pause()
      detach()
      if (BankApps.isBankApp(fg)) {
        lastBank = fg
        Log.d(TAG, "bank-app vooraan ($fg): venster verwijderd")
      }
    }
    if (attached && screenOn && motionAllowed()) b.play() else b.pause()
    // Waarom altijd pollen met toegang, en niet enkel met "enkel op het startscherm": de bank-regel geldt ook als de
    // bubbel boven alle apps zweeft. Anders lag het venster boven KBC zodra iemand die schakelaar uitzette.
    val need = screenOn && !appVisible && usage
    if (need && !watching) {
      watching = true
      main.post(watch)
    } else if (!need && watching) {
      watching = false
      main.removeCallbacks(watch)
      if (!usage) foreground = null
    }
  }

  /** Staat er nu een bank-app vooraan (enkel als we het zeker weten)? Voor de statusregel in Instellingen. */
  internal fun bankInFront(): Boolean = usageAccess(this) && BankApps.isBankApp(foreground)

  // --- Startscherm of andere app? ---------------------------------------------------------------------

  /**
   * Op het startscherm? Ruim gemeten: elk startscherm dat Android kent, de bekende launchers op naam (One UI Home,
   * Pixel, ...), en Nex Pi Control zelf (net verlaten: de launcher logt zijn terugkeer niet altijd meteen).
   * Onbekend = tonen.
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
      // geen lijst: dan tonen we overal
    }
    return found
  }

  /**
   * Leest de laatste "naar voorgrond"-gebeurtenis sinds de vorige keer. Enkel lezen, niets wordt bewaard.
   *
   * Waarom UsageStatsManager en geen AccessibilityService: een toegankelijkheidsdienst kan alles lezen wat op je
   * scherm staat, en net dat soort dienst behandelen bank-apps als risico. We zouden het ene probleem door het andere
   * vervangen. Gebruiksgegevens geven enkel de pakketnaam en het tijdstip van een app die naar voren komt. MOVE_TO_FOREGROUND is dezelfde waarde (1) als
   * ACTIVITY_RESUMED vanaf Android 10, dus dit vangt beide.
   */
  private fun pollForeground() {
    try {
      val usm = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
      val now = System.currentTimeMillis()
      val from = if (lastEventAt > 0) lastEventAt else now - 60_000
      val events = usm.queryEvents(from, now) ?: return
      val e = UsageEvents.Event()
      while (events.hasNextEvent()) {
        events.getNextEvent(e)
        @Suppress("DEPRECATION")
        if (e.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND && e.packageName != foreground) {
          foreground = e.packageName
          Log.d(TAG, "voorgrond: ${e.packageName} (startscherm: ${onHomeScreen()})")
        }
        if (e.timeStamp > lastEventAt) lastEventAt = e.timeStamp
      }
    } catch (e: Exception) {
      // geen toegang (meer): refresh() valt terug op overal tonen
    }
  }
}
