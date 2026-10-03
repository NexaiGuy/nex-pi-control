package be.nexai.floatingpi

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Brug tussen de app (src/lib/floatingPi.ts) en FloatingPiService. */
class FloatingPiModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("FloatingPi")

    /** In deze build aanwezig (plugins/withFloatingIcon.js met enabled: true)? */
    Function("isSupported") { FloatingPiService.isDeclared(context) }

    /** Toestemming "Weergeven over andere apps" gegeven? */
    Function("canDrawOverlays") { FloatingPiService.canDraw(context) }

    /** Opent het Android-scherm waar je die toestemming geeft, rechtstreeks voor deze app. */
    Function("openPermissionSettings") {
      val i = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + context.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(i)
    }

    /** Statusregel voor Instellingen (dienst, toestemmingen, voorgrond-app, startscherm). */
    Function("status") { FloatingPiService.status(context) }

    /** "Toegang tot gebruiksgegevens" gegeven? Nodig voor "enkel op het startscherm". */
    Function("hasUsageAccess") { FloatingPiService.usageAccess(context) }

    /** Opent het Android-scherm "Toegang tot gebruiksgegevens" (waar mogelijk meteen voor deze app). */
    Function("openUsageAccessSettings") {
      val direct = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:" + context.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(direct)
      } catch (e: Exception) {
        context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }

    Function("isHomeOnly") { FloatingPiService.homeOnly(context) }

    Function("setHomeOnly") { value: Boolean -> FloatingPiService.setHomeOnly(context, value) }

    Function("recheck") { FloatingPiService.recheck() }

    /** Wat de gebruiker koos in Instellingen. Naar het kruis slepen verandert dit niet (dat verbergt hem enkel tijdelijk). */
    Function("isEnabled") { FloatingPiService.prefs(context).getBoolean("enabled", false) }

    Function("isRunning") { FloatingPiService.running }

    Function("start") { labels: Map<String, String> -> FloatingPiService.enable(context, labels) }

    Function("stop") { FloatingPiService.disable(context) }

    Function("setStatus") { level: String -> FloatingPiService.setStatus(context, level) }

    Function("setAppVisible") { visible: Boolean -> FloatingPiService.setAppVisible(visible) }

    OnActivityEntersForeground { FloatingPiService.setAppVisible(true) }

    OnActivityEntersBackground { FloatingPiService.setAppVisible(false) }
  }
}
