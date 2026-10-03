# Stillere ventilator (Raspberry Pi 5)

Zet een fan-curve in `/boot/firmware/config.txt`, in een eigen blok tussen `# >>> hal-quiet-fan` en `# <<< hal-quiet-fan`.

**Hoe het werkt (profiel quiet, standaard):**

1. Het script meet ongeveer 40 seconden hoeveel toeren jouw ventilator draait per stand, en zet daarna alles terug zoals het was. Dat gebeurt enkel als de CPU onder 70 °C zit.
2. Het kiest de hoogste stand die onder `--max-rpm` blijft (standaard 3000), met 150 rpm marge.
3. Curve: 55 °C laagste stand (75), 63 °C halverwege, 70 °C de gekozen grens. Vanaf 78 °C mag hij volle kracht, net voor de Pi bij 80 °C zelf begint te vertragen. Met `--no-safety` blijft hij ook dan onder de grens; dan vertraagt de Pi zichzelf bij zware belasting.

- Stand 75 (op 255) is de laagste waarbij de Active Cooler betrouwbaar blijft draaien. Lager valt hij stil, dus dat doen we niet.
- Werkt na een herstart. Eerst een back-up van config.txt (`config.txt.hal-bak-<tijd>`).
- Eigen `fan_temp`-regels buiten het blok worden niet overschreven zonder `--force`.

`sudo bash install.sh [--max-rpm 3000] [--no-safety] [--profile quiet|balanced] [--uninstall]`
