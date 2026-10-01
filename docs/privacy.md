# Privacy policy: Nex Pi Control

*Effective date: 27 September 2026*

Nex Pi Control is a free app by Nex AI (Ghent, Belgium) to monitor and manage your own Raspberry Pi or Linux server. This policy explains what the app does with data. The short version: **we do not collect any data.** The app has no account, no analytics, no advertising and no tracking.

## What the app stores on your phone

| Data | Where | Why |
|---|---|---|
| Server addresses, server name | Android Keystore (encrypted), on your phone only | To connect to your server |
| Agent token, shell token, optional Cloudflare Access service token | Android Keystore (encrypted), not included in backups | To authenticate to your server |
| Settings (alert thresholds, lock timeout, terminal snippets) | Android Keystore (encrypted) | Your preferences |
| Recent server data (for offline viewing) and alert state | The app's private storage | Show the last known status when the server is unreachable, avoid repeated alerts |

None of this is sent to Nex AI or to any third party. You can erase all of it at any time with **Settings, Erase all data from this phone**, or by uninstalling the app.

## Network connections

The app only connects to the server addresses you enter or scan yourself. Those connections go directly from your phone to your server, optionally through a service you chose and configured yourself (Tailscale or Cloudflare). Their privacy policies apply to that part of the route.

The app does not contact Nex AI servers. Links in the About screen (our website, GitHub, email, Google Play) open in your browser or mail app only when you tap them.

The built-in demo uses sample data inside the app and makes no network connections.

## Permissions

| Permission | Use |
|---|---|
| Camera | Only to scan the QR code with your connection details. Images are processed on the phone and never stored or sent. |
| Biometrics | To unlock the app. Android handles your fingerprint, the app only receives "success" or "failure". |
| Notifications | To show alerts about your server. They are generated on your phone, there is no push server. |
| Internet | To reach your own server. |

## Your server

The agent you install on your Raspberry Pi stores statistics and an audit log on that Pi only. It does not send anything to Nex AI. When you open the Updates screen, the agent asks GitHub for the newest release of its source code (no personal data, at most once every 6 hours; you can turn this off with `HAL_UPDATE_CHECK=0`). The home screen widget shows status data of your Pi on your own phone only. Its source code is public at [github.com/NexaiGuy/nex-pi-control](https://github.com/NexaiGuy/nex-pi-control).

## Children

The app is a technical tool for server administrators and is not directed at children.

## Your rights

Because we do not collect or receive personal data through the app, we have no personal data about you to access, correct or delete. The app is set up with the GDPR principles of data minimisation and privacy by design in mind. For questions, contact us.

## Changes

If this policy changes, we update this page and the effective date above. Material changes are also mentioned in the app's release notes.

## Contact

Nex AI, Ghent, Belgium
[info@nex-ai.be](mailto:info@nex-ai.be) · [nex-ai.be](https://nex-ai.be)
