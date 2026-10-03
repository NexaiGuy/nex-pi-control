package be.nexai.floatingpi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Legt vast wanneer de zwevende bubbel voor een bank-app wijkt.
 *
 * Waarom deze test bestaat: KBC startte niet zolang ons overlayvenster boven het scherm lag. Valt een prefix weg of
 * wordt de match te ruim (bv. elke onbekende app verbergen), dan merk je dat pas aan de kassa of bij een vergeten
 * bevestiging in itsme. Deze test faalt dan eerst.
 */
class BankAppsTest {
  /** De exacte lijst uit de afspraak. Toevoegen of schrappen moet bewust gebeuren, dus ook hier. */
  @Test
  fun lijstIsExactDeAfgesprokenLijst() {
    assertEquals(
      listOf(
        "com.kbc.", "com.bnpp.", "be.belfius", "be.argenta", "be.keytradebank", "be.bmid.itsme",
        "mobi.inthepocket.bcmc", "com.ing.", "be.axa", "com.crelan", "com.revolut", "com.n26", "nl.abnamro",
        "nl.rabobank", "com.triodos", "com.google.android.apps.walletnfcrel", "com.samsung.android.spay",
      ),
      BankApps.PREFIXES,
    )
  }

  /** De pakketnaam die op het toestel gemeten werd (adb shell pm list packages). */
  @Test
  fun kbcZoalsGemetenOpHetToestel() {
    assertTrue(BankApps.isBankApp("com.kbc.mobile.android.phone.kbc"))
  }

  /** Elke prefix matcht een app in die naamruimte, en de prefix zelf (bv. be.bmid.itsme). */
  @Test
  fun elkePrefixMatcht() {
    for (p in BankApps.PREFIXES) {
      val inNamespace = p.trimEnd('.') + ".app"
      assertTrue("$inNamespace zou moeten matchen", BankApps.isBankApp(inNamespace))
      if (!p.endsWith(".")) assertTrue("$p zelf zou moeten matchen", BankApps.isBankApp(p))
    }
  }

  /** Onbekend of niet te meten: de knop blijft. Enkel een positieve match verbergt hem. */
  @Test
  fun nullLeegEnOnbekendMatchenNiet() {
    assertFalse(BankApps.isBankApp(null))
    assertFalse(BankApps.isBankApp(""))
    assertFalse(BankApps.isBankApp("   "))
    assertFalse(BankApps.isBankApp("com.sec.android.app.launcher"))
    assertFalse(BankApps.isBankApp("be.nexai.picontrol"))
    assertFalse(BankApps.isBankApp("com.whatsapp"))
    assertFalse(BankApps.isBankApp("com.google.android.apps.maps"))
  }

  /** Een prefix met punt is een grens: com.ing. is ING, com.ingenico niet; com.kbc. is KBC, com.kbcx niet. */
  @Test
  fun puntIsEenGrens() {
    assertFalse(BankApps.isBankApp("com.ingenico.pos"))
    assertFalse(BankApps.isBankApp("com.kbcx.game"))
    assertFalse(BankApps.isBankApp("com.bnppx.tool"))
  }

  /** Enkel vooraan matchen: een bankprefix ergens in het midden van een naam telt niet. */
  @Test
  fun enkelAlsBeginVanDeNaam() {
    assertFalse(BankApps.isBankApp("org.fake.com.kbc.mobile"))
    assertFalse(BankApps.isBankApp("xbe.belfius"))
  }

  /** De regel van de service: bank vooraan = geen venster, ongeacht "enkel op het startscherm". */
  @Test
  fun bubbelWijktVoorBankAppOokBovenAlleApps() {
    val kbc = "com.kbc.mobile.android.phone.kbc"
    assertFalse(BankApps.bubbleVisible(appVisible = false, homeOnly = false, onHome = false, foreground = kbc))
    assertFalse(BankApps.bubbleVisible(appVisible = false, homeOnly = true, onHome = true, foreground = kbc))
  }

  /** Terug naar het startscherm of een gewone app (zonder "enkel startscherm"): de bubbel komt terug. */
  @Test
  fun bubbelKomtTerugNaBankApp() {
    assertTrue(BankApps.bubbleVisible(false, false, true, "com.sec.android.app.launcher"))
    assertTrue(BankApps.bubbleVisible(false, false, false, "com.whatsapp"))
    assertTrue(BankApps.bubbleVisible(false, true, true, "com.sec.android.app.launcher"))
  }

  /** Niet te meten (geen gebruiksgegevens, nog geen gebeurtenis): de bubbel blijft. */
  @Test
  fun onbekendeVoorgrondHoudtDeBubbel() {
    assertTrue(BankApps.bubbleVisible(appVisible = false, homeOnly = false, onHome = true, foreground = null))
  }

  /** Bestaande regels blijven: app zelf open = weg, "enkel startscherm" in een andere app = weg. */
  @Test
  fun bestaandeRegelsBlijven() {
    assertFalse(BankApps.bubbleVisible(true, false, true, null))
    assertFalse(BankApps.bubbleVisible(false, true, false, "com.whatsapp"))
  }
}
