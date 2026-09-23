# Printing from PackPerks to the Epson TM-m30III

The dashboard talks to the printer over the network with **ePOS-Print**: it
POSTs an XML document to `http://<printer-ip>/cgi-bin/epos/service.cgi`. There
is no driver to install and nothing to configure in macOS — the Mac only has
to be able to reach the printer's IP. That is the whole job.

Everything below is for **Generate → Dynamic QR code**, which is the only page
that prints. For the artwork designs themselves — the file format, and what to
do to drive a printer that is not this one — see
[receipt-designs.md](receipt-designs.md).

---

## The short version

1. Plug the printer into power and into Ethernet — straight into the Mac
   (USB-C → Ethernet adapter) or into the same router/switch the Mac is on.
2. Turn it on and wait about a minute. It prints its IP address by itself.
3. If it is cabled straight to the Mac: System Settings → Network → the
   Ethernet adapter → Details → TCP/IP → **Manually**, IP `192.168.192.100`,
   subnet `255.255.255.0`. (Skip this if it is on your router.)
4. Open `http://<printer-ip>` in a browser to check you can reach it.
5. In the dashboard: **Generate → Dynamic QR code → Receipt printer**, put the
   IP in, generate a batch, press **Print receipt**.

Use the dashboard over **`http://localhost:5173`**, not the live HTTPS site —
see *Why it has to be localhost* below.

---

## Finding the printer's IP

Out of the box the printer is set to get its IP automatically, and it prints
whatever it ends up with on a slip as soon as it has one:

- **On a router or switch** — the router's DHCP gives it an address, usually
  `192.168.1.x` or similar.
- **Straight into the Mac**, with no DHCP anywhere — after about a minute it
  falls back to a fixed **`192.168.192.168`**. (The minute is counted from
  power-on, once it has seen the cable.)

If you missed the slip, print a status sheet:

1. Open the roll paper cover.
2. Hold the **Feed** button for at least a second.
3. Close the cover. A slip starting with "Next Action" prints.
4. Press Feed briefly the number of times shown next to the sheet you want,
   then hold Feed for a second. The status sheet prints, IP and all.

---

## Setting the Mac's IP (direct cable only)

Only needed when the printer and the Mac are joined by one cable with no
router in between. The two have to be on the same subnet:

| | Printer | Mac |
|---|---|---|
| IP address | `192.168.192.168` | `192.168.192.100` |
| Subnet mask | `255.255.255.0` | `255.255.255.0` |

System Settings → Network → your Ethernet adapter → **Details…** → TCP/IP →
Configure IPv4: **Manually** → fill in the two rows above → OK → Apply.

Router/gateway and DNS can stay empty. Wi-Fi keeps working for everything
else; this only changes the wired adapter.

Check it works:

```bash
ping -c 3 192.168.192.168
```

---

## In the dashboard

**Generate → Dynamic QR code**:

- **Receipt printer → Printer IP address** — the IP from above. It is saved in
  the browser, so you only do this once per machine.
- **Logo key codes** — leave both blank. They are for a logo stored in the
  printer's own memory; blank means the receipt's header is rendered and sent
  as an image, which is what matches the preview.
- **Design** — the tall receipt, or one of the four artworks (Banknote Simple,
  Banknote Full, Willy Wonka, Ticket).
- Set the cup count, press **Generate**, then **Print receipt**.

The artworks are landscape, so they print **turned a quarter turn** and run
about 150 mm down the roll. That is deliberate: printed upright on 80 mm paper
their QR code comes out around 10 mm across and a phone cannot read it.
Sideways it is about 25 mm.

---

## Why it has to be localhost

The browser refuses to let an HTTPS page talk to a plain HTTP address, so the
live dashboard on `https://perks.packback.network` cannot reach a printer at
`http://192.168.192.168`. The code follows the page's protocol, so:

- **`http://localhost:5173/admin`** → talks HTTP to the printer. Works with no
  further setup. **Use this for testing.**
- **The live HTTPS dashboard** → talks HTTPS to the printer, which needs the
  printer's TLS ePOS-Print turned on and its self-signed certificate trusted
  in the browser once. Set that up only if someone needs to print from the
  deployed site.

---

## When it does not print

**"Could not reach the printer at …"** — the POST never arrived.

- `ping` the IP. If that fails it is the cable, the IP, or the subnet.
- Check you are on `http://localhost`, not the HTTPS site (above).
- Give it a full minute after power-on; the network stack takes ~40 seconds to
  come up and up to a minute more to settle on the fallback IP.
- A LAN cable disables Wi-Fi on the printer, and vice versa. Pick one.

**"Printer rejected the job"** — it arrived and the printer said no. Almost
always the roll cover is open, the paper has run out, or the device id is
wrong (the app uses `local_printer`, which is the default).

**Nothing comes out and no error** — check the printer's own page at
`http://<printer-ip>`. Logging in to Advanced Settings asks for a password:
it is the **printer's serial number**, on the nameplate or on the self-test
slip.

---

## What this does not cover

- **USB.** ePOS-Print is a network protocol; a USB cable will not do. Use
  Ethernet or Wi-Fi.
- **Wi-Fi.** Supported by the printer and works the same way once it has an IP
  on your network — set it up in the printer's Web Config, then put that IP in
  the dashboard.

Source: Epson TM-m30III Technical Reference Guide (rev B), chapters 2–4.
