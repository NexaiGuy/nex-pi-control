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

    /** Flex Window: tot wanneer (ms, wandklok) het intro van de cover-widget loopt. 0: geen intro, meteen tekenen. */
    Function("coverIntroUntil") { CoverScreen.introUntil(context).toDouble() }

    /** Flex Window: de servernaam onder de draaiende behuizing in het laadscherm. */
    Function("setCoverCaption") { text: String -> CoverScreen.setCaption(context, text) }

    /** Flex Window: het intro meteen tonen (logo, daarna de draaiende behuizing), bv. als de widget net geplaatst is. */
    Function("playCoverIntro") { CoverScreen.playIntro(context) }

    /** Flex Window: de cijfers tekenen in de native layout (JSON uit src/widget/coverModel.ts). */
    Function("renderCover") { json: String -> CoverScreen.renderData(context, json) }

    /** Staat de app zelf op het cover-scherm (Good Lock MultiStar)? Dan toont hij het cover-dashboard. */
    Function("isOnCoverDisplay") { CoverScreen.isActivityOnCover(appContext.currentActivity) }

    OnActivityEntersForeground { WidgetLiveService.setAppVisible(true) }

    OnActivityEntersBackground { WidgetLiveService.setAppVisible(false) }
  }
}
