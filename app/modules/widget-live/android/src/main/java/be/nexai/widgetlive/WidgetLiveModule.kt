package be.nexai.widgetlive

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Brug tussen de app (src/lib/widgetLive.ts) en WidgetLiveService. */
class WidgetLiveModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("WidgetLive")

    /** In deze build aanwezig (plugins/withWidgetLive.js met enabled: true)? */
    Function("isSupported") { WidgetLiveService.isDeclared(context) }

    /** Wat de gebruiker koos in Instellingen. */
    Function("isEnabled") { WidgetLiveService.isEnabled(context) }

    Function("isRunning") { WidgetLiveService.running }

    /** Aanzetten, of de tekst van de melding bijwerken als hij al draait. */
    Function("start") { labels: Map<String, String> -> WidgetLiveService.enable(context, labels) }

    /** Opnieuw starten als hij aan staat maar niet draait (bij het openen van de app). */
    Function("resume") { WidgetLiveService.start(context) }

    Function("stop") { WidgetLiveService.disable(context) }

    Function("getInterval") { WidgetLiveService.interval(context) }

    Function("setInterval") { seconds: Int -> WidgetLiveService.setInterval(context, seconds) }

    Function("hasUsageAccess") { WidgetLiveService.usageAccess(context) }

    Function("status") { WidgetLiveService.status(context) }

    OnActivityEntersForeground { WidgetLiveService.setAppVisible(true) }

    OnActivityEntersBackground { WidgetLiveService.setAppVisible(false) }
  }
}
