"""Tweetalige berichten (nl/en). De taal volgt de Accept-Language-header van de app, standaard Engels.

Gebruik: L("Nederlandse tekst", "English text"). Werkt ook met f-strings.
"""

from __future__ import annotations

import contextvars
import os

DEFAULT = "nl" if os.environ.get("HAL_LANG", "en").lower().startswith("nl") else "en"
_lang: contextvars.ContextVar[str] = contextvars.ContextVar("hal_lang", default=DEFAULT)


def L(nl: str, en: str) -> str:
    return nl if _lang.get() == "nl" else en


def lang_from_header(value: str | None) -> str:
    if not value:
        return DEFAULT
    first = value.split(",")[0].strip().lower()
    return "nl" if first.startswith("nl") else "en"


def set_lang(lang: str) -> contextvars.Token:
    return _lang.set("nl" if lang == "nl" else "en")


def reset_lang(token: contextvars.Token) -> None:
    _lang.reset(token)


def current() -> str:
    return _lang.get()


# Vaste foutmeldingen: in de code in het Nederlands, vertaald bij het versturen (zie web.install_common).
_EN: dict[str, str] = {
    "Onbekende dienst": "Unknown service",
    "Onbekende container": "Unknown container",
    "Docker-proxy onbereikbaar": "Docker proxy unreachable",
    "Onbekende actie": "Unknown action",
    "Onbekend commando": "Unknown command",
    "Onbekend apparaat": "Unknown device",
    "Deze dienst staat niet in allowed-actions.yml": "This service is not listed in allowed-actions.yml",
    "Ongeldige metric (max 24, komma-gescheiden)": "Invalid metric (max 24, comma separated)",
    "Ongeldige dienstnaam": "Invalid service name",
    "Ongeldige container": "Invalid container",
    "Ongeldig commando": "Invalid command",
    "Ongeldig apparaat": "Invalid device",
    "Ongeldige invoer": "Invalid input",
    "Ongeldige herkomst": "Invalid origin",
    "Cloudflare Access is nog niet ingesteld op de server": "Cloudflare Access is not configured on the server yet",
    "Cloudflare Access-token ontbreekt": "Cloudflare Access token missing",
    "Cloudflare Access-token ongeldig": "Cloudflare Access token invalid",
    "Cloudflare Access tijdelijk niet te controleren": "Cloudflare Access cannot be verified right now",
    "Token ontbreekt of is ongeldig": "Token missing or invalid",
    "Te veel aanvragen, probeer zo meteen opnieuw": "Too many requests, try again shortly",
    "Pad valt buiten de toegelaten mappen": "Path is outside the allowed folders",
    "Geef een absoluut pad": "Provide an absolute path",
    "Bestand of map bestaat niet": "File or folder does not exist",
    "Ongeldige naam": "Invalid name",
    "Symlinks worden niet overschreven": "Symlinks are never overwritten",
    "De hoofdmap zelf kan je niet wijzigen": "The root folder itself cannot be changed",
    "Geen map": "Not a folder",
    "Geen leesrechten op deze map": "No read permission on this folder",
    "Geen bestand": "Not a file",
    "Tekstbestand te groot (max 5 MB)": "Text file too large (max 5 MB)",
    "Geen gewoon bestand": "Not a regular file",
    "Bestand is intussen gewijzigd, laad het opnieuw": "The file changed in the meantime, reload it",
    "Doel is geen map": "Target is not a folder",
    "Ongeldige bestandsnaam": "Invalid file name",
    "Er bestaat al een bestand met die naam": "A file with that name already exists",
    "Bestaat al": "Already exists",
    "Er bestaat al iets met die naam": "Something with that name already exists",
    "Bestaat niet": "Does not exist",
    "Map is niet leeg": "Folder is not empty",
    "Bestand te groot (max 100 MB)": "File too large (max 100 MB)",
    "Dit proces kan je niet beëindigen": "This process cannot be ended",
    "Enkel processen van je eigen gebruiker": "Only processes of your own user",
    "Proces bestaat niet meer": "Process no longer exists",
    "Geen rechten op dit proces": "No permission on this process",
    "GPIO niet beschikbaar": "GPIO not available",
    "Pin pulseert al": "Pin is already pulsing",
    "libgpiod niet geïnstalleerd": "libgpiod not installed",
    "Geen Raspberry Pi GPIO-chip gevonden of geen toegang": "No Raspberry Pi GPIO chip found or no access",
    "Herstart duurde langer dan 90 s": "Restart took longer than 90 s",
    "Tijdslimiet overschreden": "Time limit exceeded",
    "Fout": "Error",
}


def tr(text: str) -> str:
    """Vertaalt een vaste Nederlandse melding naar de taal van de aanvraag."""
    if _lang.get() == "nl":
        return text
    return _EN.get(text, text)
