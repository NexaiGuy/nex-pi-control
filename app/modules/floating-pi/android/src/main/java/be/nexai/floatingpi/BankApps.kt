package be.nexai.floatingpi

/**
 * Bank- en betaalapps waarvoor de zwevende Pi-behuizing helemaal van het scherm gaat.
 *
 * Waarom: KBC weigerde te openen op de Z Flip 5 (Android 16) terwijl ons overlayvenster er lag (gemeten met adb:
 * 1 venster, TYPE_APPLICATION_OVERLAY, 168x168, van FloatingPiService). Bank-apps beschermen zich tegen tapjacking,
 * een overlay die een knop over "Bevestigen" legt. Ons venster is onschuldig, maar de bank-app kan dat niet weten.
 *
 * Waarom een lijst van prefixen en geen "alles behalve het startscherm": de knop moet blijven waar hij niemand stoort.
 * We verbergen hem enkel bij een positieve match. Weten we niet welke app vooraan staat (null), of is het een app die
 * niet in de lijst staat, dan blijft hij staan.
 *
 * Bewust zonder Android-imports, zodat BankAppsTest dit gewoon op de JVM kan testen.
 */
object BankApps {
  /**
   * Prefixen van pakketnamen. Een prefix die op een punt eindigt matcht enkel die hele naamruimte
   * (com.ing. pakt com.ing.mobile, niet com.ingenico); zonder punt ook varianten (be.belfius pakt be.belfius.directmobile).
   */
  val PREFIXES: List<String> = listOf(
    "com.kbc.", // KBC, KBC Brussels, CBC
    "com.bnpp.", // BNP Paribas Fortis, Hello bank!
    "be.belfius",
    "be.argenta",
    "be.keytradebank",
    "be.bmid.itsme", // itsme: bevestigt betalingen en aanmeldingen voor bijna elke Belgische bank
    "mobi.inthepocket.bcmc", // Payconiq by Bancontact
    "com.ing.",
    "be.axa",
    "com.crelan",
    "com.revolut",
    "com.n26",
    "nl.abnamro",
    "nl.rabobank",
    "com.triodos",
    "com.google.android.apps.walletnfcrel", // Google Wallet (contactloos betalen)
    "com.samsung.android.spay", // Samsung Wallet / Pay
  )

  /** true enkel als de pakketnaam met een van de prefixen begint. null, leeg of onbekend: false (knop blijft). */
  fun isBankApp(pkg: String?): Boolean {
    if (pkg.isNullOrBlank()) return false
    return PREFIXES.any { pkg.startsWith(it) }
  }

  /**
   * Moet het venster van de bubbel bestaan? Eén plek voor de regel, zodat de test exact test wat de service doet.
   *
   * @param appVisible Nex Pi Control staat zelf open (dan is de bubbel overbodig).
   * @param homeOnly "Enkel op het startscherm" staat aan en we hebben toegang tot gebruiksgegevens.
   * @param onHome het startscherm (of iets onbekends) staat vooraan.
   * @param foreground de app die vooraan staat volgens UsageStatsManager, null als we het niet weten.
   */
  fun bubbleVisible(appVisible: Boolean, homeOnly: Boolean, onHome: Boolean, foreground: String?): Boolean =
    !appVisible && !isBankApp(foreground) && (!homeOnly || onHome)
}
