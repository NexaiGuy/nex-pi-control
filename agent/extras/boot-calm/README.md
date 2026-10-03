# Rustige opstart (hal-boot-calm)

Na een herstart start alles op een Pi tegelijk: Docker-containers, databases, je eigen diensten en
timers die een gemiste run inhalen. Dat duwt de CPU een minuut of twee naar 100%.

Rustige opstart begrenst tijdens de eerste minuten na het opstarten de CPU van `system.slice`
(alle systeemdiensten en, met de systemd cgroup-driver van Docker, ook alle containers).
Standaard 70% van alle kernen samen, 5 minuten lang. Daarna valt de grens vanzelf weg.

- Alles start nog steeds, het duurt alleen wat langer. Er wordt niets gestopt of uitgesteld.
- De grens is tijdelijk (`systemctl set-property --runtime`): niets wordt blijvend aangepast.
- Je eigen SSH-sessie (`user.slice`) en de kernel zelf vallen erbuiten, dus de grafiek kan nog net boven de grens tikken.
- Het eerste stuk van de opstart, vóór systemd draait, is niet te begrenzen en wordt ook niet gemeten.

Installeren, aanpassen of verwijderen: `sudo bash install.sh [--percent 70] [--minutes 5] [--uninstall]`.
Na een herstart controleren: `journalctl -t hal-boot-calm -b` en `hal-boot-calm status`.
