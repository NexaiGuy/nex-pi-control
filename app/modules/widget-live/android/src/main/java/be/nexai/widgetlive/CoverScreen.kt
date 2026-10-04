package be.nexai.widgetlive

import android.app.Activity
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.hardware.display.DisplayManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.util.Log
import android.view.Display
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject

/**
 * De Flex Window-widget (cover-scherm van de Galaxy Z Flip): intro, laadscherm, cijfers en verversen.
 *
 * Alles hier is een native layout (RemoteViews), geen afbeelding: Samsungs cover-scherm geeft widgets geen of een
 * andere maat en dichtheid door dan het startscherm, en een vooraf getekende afbeelding (zoals react-native-android-
 * widget maakt) blijft daar leeg of valt ernaast. Een layout past zich zelf aan.
 *
 * Telkens het cover-scherm aangaat:
 *  1. meteen het Nex AI-logo;
 *  2. na [LOGO_MS] de draaiende Pi-behuizing als laadscherm;
 *  3. de JS-taak (src/widget/task.tsx) haalt intussen de gegevens op, wacht tot [introUntil] en geeft ze aan
 *     [renderData] (nex_cover_data.xml).
 *
 * Zolang het cover-scherm aan blijft, ververst de widget elke [REFRESH_MS].
 */
object CoverScreen {
  private const val TAG = "WidgetLive"

  /** Samsung: binnenscherm = 0, cover-scherm = 1 (Flex Window, launchDisplayId). */
  private const val COVER_DISPLAY_ID = 1

  const val LOGO_MS = 3_000L
  const val SPIN_MIN_MS = 1_800L

  /** Vangnet: tekenen de cijfers niet (taak niet gestart), dan na zo lang nog eens vragen. */
  const val SAFETY_MS = 6_000L
  const val REFRESH_MS = 15_000L

  private const val KEY_UNTIL = "cover_intro_until"
  private const val KEY_CAPTION = "cover_caption"
  private const val KEY_DRAWN = "cover_drawn"

  private const val INK = 0xFFF2F2F0.toInt()
  private const val MUTED = 0xFF8A8A94.toInt()
  private const val MINT = 0xFF34F5C5.toInt()
  private const val WARN = 0xFFFFB020.toInt()
  private const val CRIT = 0xFFFF2A1F.toInt()
  private const val PURPLE = 0xFF8B5CF6.toInt()

  private val main = Handler(Looper.getMainLooper())

  /** Telt elk intro: een uitgestelde stap van een vorig intro doet dan niets meer. */
  @Volatile
  private var introGen = 0

  /** De ontvanger die react-native-android-widget voor "PiCover" maakt (app.json, plugins/withFlexWindow.js). */
  fun provider(ctx: Context): ComponentName = ComponentName(ctx.packageName, "${ctx.packageName}.widget.PiCover")

  fun ids(ctx: Context): IntArray =
    try {
      AppWidgetManager.getInstance(ctx).getAppWidgetIds(provider(ctx))
    } catch (e: Exception) {
      IntArray(0)
    }

  /** Is het cover-scherm aan (en het binnenscherm uit, dus dichtgeklapt)? Zonder cover-scherm altijd false. */
  fun isOn(ctx: Context): Boolean =
    try {
      val dm = ctx.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
      val cover = dm.getDisplay(COVER_DISPLAY_ID)
      val builtIn = cover != null &&
        (cover.flags and Display.FLAG_PRESENTATION) == 0 &&
        (cover.flags and Display.FLAG_PRIVATE) == 0
      val main = dm.getDisplay(Display.DEFAULT_DISPLAY)
      builtIn && cover!!.state == Display.STATE_ON && (main == null || main.state != Display.STATE_ON)
    } catch (e: Exception) {
      false
    }

  /** Staat deze activiteit op het cover-scherm (de app op de Flex Window via Good Lock MultiStar)? */
  fun isActivityOnCover(a: Activity?): Boolean =
    try {
      val d = when {
        a == null -> null
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> a.display
        else -> @Suppress("DEPRECATION") a.windowManager.defaultDisplay
      }
      d?.displayId == COVER_DISPLAY_ID
    } catch (e: Exception) {
      false
    }

  /** Tot wanneer (wandklok, ms) het intro loopt. 0: geen intro, meteen tekenen. */
  fun introUntil(ctx: Context): Long {
    val until = WidgetLiveService.prefs(ctx).getLong(KEY_UNTIL, 0L)
    // Een intro duurt nooit langer dan een paar seconden: alles wat veel ouder of te ver weg is, telt niet.
    val now = System.currentTimeMillis()
    return if (until > now - 60_000 && until < now + LOGO_MS + SPIN_MIN_MS + 1_000) until else 0L
  }

  /** De servernaam onder de draaiende behuizing; de JS-taak zet hem na elke weergave. */
  fun setCaption(ctx: Context, text: String) {
    val p = WidgetLiveService.prefs(ctx)
    val clean = text.trim().take(40)
    if (p.getString(KEY_CAPTION, null) != clean) p.edit().putString(KEY_CAPTION, clean).apply()
  }

  /**
   * Speelt het intro: meteen het logo, na [LOGO_MS] de draaiende behuizing. Zet ook het tijdstip waarop de cijfers
   * mogen komen. Geeft false als er geen Flex Window-widget staat.
   */
  fun playIntro(ctx: Context): Boolean {
    val ids = ids(ctx)
    if (ids.isEmpty()) return false
    val gen = ++introGen
    val app = ctx.applicationContext
    WidgetLiveService.prefs(app).edit().putLong(KEY_UNTIL, System.currentTimeMillis() + LOGO_MS + SPIN_MIN_MS).apply()
    push(app, ids, RemoteViews(app.packageName, R.layout.nex_cover_intro))
    main.postDelayed({ if (gen == introGen) showSpinner(app) }, LOGO_MS)
    return true
  }

  /**
   * Vanuit de ontvanger (plugins/withFlexWindow.js), zonder JS: toonde de widget nog nooit cijfers, dan meteen het
   * logo, zodat het vak op het cover-scherm nooit leeg is. De cijfers volgen via de JS-taak.
   */
  fun paintIfEmpty(ctx: Context) {
    try {
      if (!WidgetLiveService.prefs(ctx).getBoolean(KEY_DRAWN, false) && introUntil(ctx) == 0L) playIntro(ctx)
    } catch (e: Exception) {
      Log.w(TAG, "cover eerste beeld mislukt: ${e.message}")
    }
  }

  /** Widget weg van het cover-scherm: wordt hij opnieuw geplaatst, dan eerst weer het logo. */
  fun forgetDrawn(ctx: Context) {
    if (ids(ctx).isEmpty()) WidgetLiveService.prefs(ctx).edit().putBoolean(KEY_DRAWN, false).apply()
  }

  /** Cover-scherm uit: geen uitgestelde stappen meer, en de cijfers mogen meteen. */
  fun cancelIntro(ctx: Context) {
    introGen++
    WidgetLiveService.prefs(ctx).edit().putLong(KEY_UNTIL, 0L).apply()
  }

  private fun showSpinner(ctx: Context) {
    val ids = ids(ctx)
    if (ids.isEmpty()) return
    val p = WidgetLiveService.prefs(ctx)
    val v = RemoteViews(ctx.packageName, R.layout.nex_cover_spin)
    v.setTextViewText(R.id.nex_cover_caption, p.getString(KEY_CAPTION, null)?.takeIf { it.isNotBlank() } ?: "Nex Pi Control")
    v.setTextViewText(R.id.nex_cover_sub, p.getString("label_loading", null) ?: "Connecting")
    push(ctx, ids, v)
  }

  /** Vraagt de cover-widget(s) opnieuw te tekenen: dezelfde APPWIDGET_UPDATE als Android zelf stuurt. */
  fun requestUpdate(ctx: Context): Int {
    val ids = ids(ctx)
    if (ids.isEmpty()) return 0
    try {
      ctx.sendBroadcast(
        Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
          .setComponent(provider(ctx))
          .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids),
      )
    } catch (e: Exception) {
      Log.w(TAG, "cover verversen mislukt: ${e.message}")
    }
    return ids.size
  }

  // --- De cijfers (stap 3) -------------------------------------------------------------------------

  private val METRICS = intArrayOf(R.id.nex_cover_m0_label, R.id.nex_cover_m0_value, R.id.nex_cover_m1_label, R.id.nex_cover_m1_value,
    R.id.nex_cover_m2_label, R.id.nex_cover_m2_value, R.id.nex_cover_m3_label, R.id.nex_cover_m3_value)
  private val LEFT = intArrayOf(R.id.nex_cover_l0_label, R.id.nex_cover_l0_value, R.id.nex_cover_l1_label, R.id.nex_cover_l1_value,
    R.id.nex_cover_l2_label, R.id.nex_cover_l2_value, R.id.nex_cover_l3_label, R.id.nex_cover_l3_value,
    R.id.nex_cover_l4_label, R.id.nex_cover_l4_value)
  private val NET = intArrayOf(R.id.nex_cover_n0_label, R.id.nex_cover_n0_value, R.id.nex_cover_n1_label, R.id.nex_cover_n1_value)
  private val SPARKS = intArrayOf(R.id.nex_cover_n0_spark, R.id.nex_cover_n1_spark)
  private val RIGHT = intArrayOf(R.id.nex_cover_r0_label, R.id.nex_cover_r0_value, R.id.nex_cover_r1_label, R.id.nex_cover_r1_value)
  private val COUNTS = intArrayOf(R.id.nex_cover_c0_dot, R.id.nex_cover_c0_label, R.id.nex_cover_c0_value,
    R.id.nex_cover_c1_dot, R.id.nex_cover_c1_label, R.id.nex_cover_c1_value,
    R.id.nex_cover_c2_dot, R.id.nex_cover_c2_label, R.id.nex_cover_c2_value,
    R.id.nex_cover_c3_dot, R.id.nex_cover_c3_label, R.id.nex_cover_c3_value)

  fun levelColor(level: String?): Int =
    when (level) {
      "critical" -> CRIT
      "warning" -> WARN
      "offline" -> MUTED
      else -> MINT
    }

  /**
   * Tekent de cijfers. [json] komt uit src/widget/coverModel.ts (enkel opgemaakte tekst, niveaus en reeksen, nooit
   * adressen of sleutels). Geeft false als er geen widget staat of de gegevens niet kloppen.
   */
  fun renderData(ctx: Context, json: String): Boolean {
    val ids = ids(ctx)
    if (ids.isEmpty()) return false
    return try {
      val m = JSONObject(json)
      val value = if (m.optBoolean("dim")) MUTED else INK
      val v = RemoteViews(ctx.packageName, R.layout.nex_cover_data)

      val alarm = m.optString("alarm", "")
      if (alarm.isNotEmpty()) {
        v.setViewVisibility(R.id.nex_cover_header, View.GONE)
        v.setViewVisibility(R.id.nex_cover_alarm, View.VISIBLE)
        v.setTextViewText(R.id.nex_cover_alarm, "◆  $alarm")
      } else {
        v.setTextColor(R.id.nex_cover_dot, levelColor(m.optString("level")))
        v.setTextViewText(R.id.nex_cover_status, m.optString("status"))
        v.setTextViewText(R.id.nex_cover_server, m.optString("server"))
        v.setTextViewText(R.id.nex_cover_time, m.optString("time"))
      }

      val reasons = m.optJSONArray("reasons")
      if (reasons != null && reasons.length() > 0) {
        val sb = SpannableStringBuilder()
        for (i in 0 until reasons.length()) {
          val r = reasons.optJSONObject(i) ?: continue
          if (sb.isNotEmpty()) sb.append('\n')
          val start = sb.length
          sb.append("◆ ")
          sb.setSpan(ForegroundColorSpan(levelColor(r.optString("level"))), start, start + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
          sb.append(r.optString("text"))
        }
        v.setTextViewText(R.id.nex_cover_reasons, sb)
        v.setViewVisibility(R.id.nex_cover_reasons, View.VISIBLE)
        v.setViewVisibility(R.id.nex_cover_band, View.GONE)
      }

      fillRows(v, m.optJSONArray("metrics"), METRICS, value)
      fillRows(v, m.optJSONArray("left"), LEFT, value)
      fillRows(v, m.optJSONArray("net"), NET, value)
      fillRows(v, m.optJSONArray("right"), RIGHT, value)

      val net = m.optJSONArray("net")
      for (i in SPARKS.indices) {
        val bmp = spark(ctx, net?.optJSONObject(i)?.optJSONArray("spark"), m.optBoolean("dim"))
        if (bmp != null) v.setImageViewBitmap(SPARKS[i], bmp) else v.setViewVisibility(SPARKS[i], View.INVISIBLE)
      }

      val counts = m.optJSONArray("counts")
      for (i in 0 until 4) {
        val c = counts?.optJSONObject(i)
        v.setTextColor(COUNTS[i * 3], levelColor(c?.optString("level")))
        v.setTextViewText(COUNTS[i * 3 + 1], c?.optString("label") ?: "")
        v.setTextViewText(COUNTS[i * 3 + 2], c?.optString("value") ?: "·")
        v.setTextColor(COUNTS[i * 3 + 2], value)
      }
      v.setTextViewText(R.id.nex_cover_foot, m.optString("foot"))
      push(ctx, ids, v)
      WidgetLiveService.prefs(ctx).edit().putBoolean(KEY_DRAWN, true).apply()
      true
    } catch (e: Exception) {
      Log.w(TAG, "cover-cijfers tekenen mislukt: ${e.message}")
      false
    }
  }

  /** Paren label/waarde; ontbreekt een rij, dan blijft het vak leeg. */
  private fun fillRows(v: RemoteViews, rows: JSONArray?, slots: IntArray, value: Int) {
    for (i in 0 until slots.size / 2) {
      val r = rows?.optJSONObject(i)
      v.setTextViewText(slots[i * 2], r?.optString("label") ?: "")
      v.setTextViewText(slots[i * 2 + 1], r?.optString("value") ?: "")
      v.setTextColor(slots[i * 2 + 1], value)
    }
  }

  /** Kleine lijn van de laatste 24 uur, op de maat van het vak (fitXY). */
  private fun spark(ctx: Context, arr: JSONArray?, dim: Boolean): Bitmap? {
    if (arr == null || arr.length() < 2) return null
    val d = ctx.resources.displayMetrics.density
    val w = (150 * d).toInt().coerceAtLeast(40)
    val h = (10 * d).toInt().coerceAtLeast(8)
    val pts = DoubleArray(arr.length()) { arr.optDouble(it, 0.0).takeIf { v -> v.isFinite() } ?: 0.0 }
    val min = pts.minOrNull() ?: 0.0
    val max = pts.maxOrNull() ?: 0.0
    val span = if (max - min > 0) max - min else 1.0
    val pad = 1.2f * d
    val line = Path()
    pts.forEachIndexed { i, p ->
      val x = i * (w - 1f) / (pts.size - 1)
      val y = (h - pad - ((p - min) / span) * (h - 2 * pad)).toFloat()
      if (i == 0) line.moveTo(x, y) else line.lineTo(x, y)
    }
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val col = if (dim) MUTED else PURPLE
    val area = Path(line).apply {
      lineTo(w - 1f, h.toFloat())
      lineTo(0f, h.toFloat())
      close()
    }
    c.drawPath(area, Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = (col and 0x00FFFFFF) or 0x33000000 })
    c.drawPath(line, Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 1.2f * d; color = col; strokeJoin = Paint.Join.ROUND })
    return bmp
  }

  private fun push(ctx: Context, ids: IntArray, views: RemoteViews) {
    try {
      views.setOnClickPendingIntent(R.id.nex_cover_root, openCover(ctx))
      AppWidgetManager.getInstance(ctx).updateAppWidget(ids, views)
    } catch (e: Exception) {
      Log.w(TAG, "cover tekenen mislukt: ${e.message}")
    }
  }

  /** Tik op de widget: het volledige cover-scherm van de app (nexpicontrol://cover). */
  private fun openCover(ctx: Context): PendingIntent {
    val i = Intent(Intent.ACTION_VIEW, Uri.parse("nexpicontrol://cover"))
      .setPackage(ctx.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(ctx, 21, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }
}
