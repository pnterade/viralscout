# Deploying ViralScout to Oracle Cloud (Always Free)

This runs ViralScout 24/7 on a free Oracle VM so it scans even when your PC is off.
It auto-starts on boot and auto-restarts if it ever crashes.

**Good to know before you start:**
- ViralScout only makes **outbound** connections (Telegram polling + API calls), so you
  do **NOT** need to open any inbound ports / security-list ingress rules. Big simplification.
- Everything below is copy-paste. Replace `PUBLIC_IP` and the key path with your own.

---

## 1. Create the free VM (Oracle Cloud Console)

1. Sign up / log in at <https://cloud.oracle.com>. (Signup needs a card for identity
   verification — Always-Free resources are never charged.)
2. **Compute → Instances → Create instance.**
3. **Image:** Canonical **Ubuntu 22.04**.
4. **Shape:** click *Change shape* →
   - **Ampere (ARM)** `VM.Standard.A1.Flex` with **1 OCPU / 6 GB** — best, free. If you get
     *"Out of host capacity"*, either try a different Availability Domain / region, or
   - **AMD** `VM.Standard.E2.1.Micro` (1 GB) — smaller but always available, still plenty.
5. **SSH keys:** choose *Generate a key pair for me* and **download the private key**
   (e.g. `viralscout.key`). Save it somewhere safe on your PC.
6. Click **Create**. When it's running, copy its **Public IP address**.

---

## 2. Connect to the VM

From PowerShell on your PC (Windows ships with `ssh`/`scp`):

```powershell
# First time only: lock down the key's permissions or ssh may refuse it
icacls "C:\path\to\viralscout.key" /inheritance:r /grant:r "$($env:USERNAME):(R)"

ssh -i "C:\path\to\viralscout.key" ubuntu@PUBLIC_IP
```

Everything from here runs **on the server** (the `ubuntu@...` prompt) unless it says "on your PC".

---

## 3. Install Node.js + git

```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node --version   # should print v22.x
```

---

## 4. Get the code onto the server

**Recommended: a private GitHub repo** (makes future updates one command). Your `.gitignore`
already excludes `.env`, `node_modules`, and the database — so no secrets get committed.

**On your PC** (PowerShell, in the project folder):

```powershell
cd C:\Users\Gamer\Claude\viralscout
git init
git add .
git commit -m "ViralScout"
# Create an EMPTY private repo at https://github.com/new (name it viralscout), then:
git remote add origin https://github.com/YOUR_USERNAME/viralscout.git
git branch -M main
git push -u origin main
```

**On the server:**

```bash
cd ~
git clone https://github.com/YOUR_USERNAME/viralscout.git
cd viralscout
```

> No GitHub? Fallback: from your PC, `scp -i "C:\path\to\viralscout.key" -r C:\Users\Gamer\Claude\viralscout ubuntu@PUBLIC_IP:~/` — but delete `node_modules` first (it's platform-specific and must be reinstalled on the server anyway).

---

## 5. Install dependencies + create the database

```bash
cd ~/viralscout
npm install
npx prisma generate
npx prisma db push
```

---

## 6. Add your secrets (.env)

Your `.env` holds your keys and is **not** in git — copy it over from your PC.

**On your PC** (PowerShell):

```powershell
scp -i "C:\path\to\viralscout.key" C:\Users\Gamer\Claude\viralscout\.env ubuntu@PUBLIC_IP:~/viralscout/.env
```

(Or on the server: `cp .env.example .env && nano .env` and paste your keys in.)

Quick test that it starts (Ctrl+C to stop after you see "Scheduler running"):

```bash
npm start
```

---

## 7. Install it as a 24/7 service

```bash
sudo cp ~/viralscout/deploy/viralscout.service /etc/systemd/system/viralscout.service
sudo systemctl daemon-reload
sudo systemctl enable --now viralscout
```

Check it's alive:

```bash
systemctl status viralscout          # should say "active (running)"
journalctl -u viralscout -f          # live logs (Ctrl+C to stop watching)
```

That's it — it's now running, will restart on crashes, and comes back automatically after
any reboot.

---

## Managing it

```bash
sudo systemctl restart viralscout    # restart (e.g. after a config change)
sudo systemctl stop viralscout       # stop
sudo systemctl start viralscout      # start
journalctl -u viralscout -n 100      # last 100 log lines
```

## Deploying changes later

```bash
cd ~/viralscout
git pull
npm install
npx prisma generate
sudo systemctl restart viralscout
```

## Changing settings

Edit `~/viralscout/.env` (e.g. `VIRAL_VIEWS`, `SCAN_INTERVAL_MINUTES`), then
`sudo systemctl restart viralscout`.

---

## Notes

- **⚠️ Run it in ONE place only.** Once the server is running, **stop ViralScout on your PC**
  (close the `npm start` window). The Telegram bot can only be polled by one process at a time —
  if both run, you'll see `409 Conflict` errors and buttons/alerts get flaky.
- **twitterapi.io credits:** until you top up, scans log `402 Credits is not enough` and
  fetch 0 posts — the service stays healthy and starts alerting the moment there's a balance.
- **ARM vs AMD:** both work; Node, Prisma, and tsx all run fine on ARM64.
- **Idle reclaim:** Oracle can stop Always-Free VMs that sit at ~0% CPU. ViralScout's
  scans give it a regular heartbeat, so this is unlikely — but if it ever happens, just
  start the instance again from the console.
- **Moving to a paid VPS later** is a 10-minute repeat of steps 2–7 on the new box — same
  files, no changes.
