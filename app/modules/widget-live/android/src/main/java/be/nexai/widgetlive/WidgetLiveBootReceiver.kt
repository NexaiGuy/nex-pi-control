package be.nexai.widgetlive

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Na een herstart van de gsm of een update van de app: staan live widgets aan, dan start de dienst opnieuw zonder dat
 * je de app eerst moet openen. Android laat een voorgrondservice van het type specialUse hier toe.
 */
class WidgetLiveBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> WidgetLiveService.start(context)
    }
  }
}
