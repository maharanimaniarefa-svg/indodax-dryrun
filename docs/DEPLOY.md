# Deploy GitHub + Vercel (turnkey)

Status per **10 November 2026 14:20 WIB**:

- **Sudah ter-deploy.** Bot berjalan di Vercel (`sin1`) dengan state di Upstash Redis.
- **Tick otomatis aktif**: GitHub Actions `.github/workflows/tick.yml` memanggil `/api/tick`
  tiap jam (menit ke-7 UTC); Vercel Cron harian sebagai cadangan.
- Task lokal `IndodaxDryRunTick` sudah **dihapus** agar tidak ada dua sumber data.
- URL produksi: `https://indodax-dryrun-uas-refa-maharani-tr.vercel.app`.
- Dokumen ini tetap disimpan sebagai panduan ulang bila perlu deploy dari nol.

> Jangan pernah menulis token/secret ke dalam repo. Semua nilai rahasia masuk ke
> environment variable Vercel / GitHub Secrets.

---

## 1. Prasyarat (sekali saja)

1. Akun **GitHub** dan repositori kosong, mis. `https://github.com/USERNAME/indodax-dryrun`.
2. Akun **Vercel** (boleh login dengan GitHub).
3. Database **Upstash Redis** gratis, region **Singapore (ap-southeast-1)**.
   - Buka <https://console.upstash.com> → Create Database.
   - Catat `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN`.
4. Node.js >= 20 (sudah ada: v24.20.0).

---

## 2. Push ke GitHub

Dari folder `indodax-dryrun`:

```powershell
git remote add origin https://github.com/USERNAME/indodax-dryrun.git
git push -u origin main
```

Jika `git push` meminta login, gunakan **Personal Access Token** GitHub sebagai password
(scope `repo`), atau install GitHub CLI:

```powershell
winget install --id GitHub.cli
gh auth login
gh repo create indodax-dryrun --public --source . --push
```

Bukti freeze = riwayat commit. **Jangan force-push** setelah freeze.

---

## 3. Deploy Vercel

### Cara A — CLI (paling cepat)

```powershell
npx vercel@latest login          # sekali, ikuti tautan di browser
npx vercel@latest link           # pilih project / buat baru, root = folder ini
npx vercel@latest --prod
```

Lalu isi environment variables (Production):

```powershell
$env:CRON_SECRET = "<string acak 64 hex>"
npx vercel@latest env add CRON_SECRET production

npx vercel@latest env add UPSTASH_REDIS_REST_URL production
npx vercel@latest env add UPSTASH_REDIS_REST_TOKEN production
npx vercel@latest env add STORE production           # isi: upstash
npx vercel@latest env add KILL_SWITCH production     # isi: 0

npx vercel@latest --prod                              # deploy ulang agar env terbaca
```

Membuat secret acak:

```powershell
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
```

### Cara B — dashboard Vercel

1. **Add New → Project**, import repo GitHub.
2. Framework Preset **Other**, Build Command kosong, Output Directory kosong.
   Root Directory `indodax-dryrun` bila repo memuat folder induk.
3. Tab **Environment Variables** → tambahkan:

   | Name | Value |
   |---|---|
   | `CRON_SECRET` | string acak panjang |
   | `UPSTASH_REDIS_REST_URL` | dari Upstash |
   | `UPSTASH_REDIS_REST_TOKEN` | dari Upstash |
   | `STORE` | `upstash` |
   | `KILL_SWITCH` | `0` |
   | `DASHBOARD_TOKEN` | kosong (read-only publik) |

4. **Deploy**.

### Cara C — script yang sudah disiapkan

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy_vercel.ps1 `
  -CronSecret "<secret>" `
  -UpstashUrl "https://xxxxx.upstash.io" `
  -UpstashToken "<token>"
```

Script melakukan: cek/login Vercel → link → set env → deploy production → uji `/api/health`.

---

## 4. Aktifkan tick utama GitHub Actions

Di repo GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

| Name | Value |
|---|---|
| `BOT_URL` | `https://PROJECT.vercel.app` |
| `CRON_SECRET` | sama dengan env Vercel |

Workflow `.github/workflows/tick.yml` berjalan tiap jam menit ke-7 UTC dan berhenti
otomatis setelah 14 November 2026. Bisa dijalankan manual lewat **Actions → Run workflow**.

Vercel Cron di `vercel.json` (`7 1 * * *`) hanya backup harian.

---

## 5. Verifikasi setelah deploy

```powershell
$env:CRON_SECRET = "<secret>"
curl.exe https://PROJECT.vercel.app/api/health
curl.exe -H "Authorization: Bearer $env:CRON_SECRET" https://PROJECT.vercel.app/api/tick
```

Yang harus terlihat:

- `/api/health` → `ok: true`
- `/api/tick` → `ok: true`, `processed` berisi 8 pair (atau `waiting`/`frozen` bila di luar jendela)
- Tanpa header secret → HTTP **401**.

Kill switch:

```powershell
curl.exe -H "Authorization: Bearer $env:CRON_SECRET" "https://PROJECT.vercel.app/api/kill?active=1&reason=manual"
curl.exe -H "Authorization: Bearer $env:CRON_SECRET" "https://PROJECT.vercel.app/api/kill?active=0"
```

---

## 6. Setelah Vercel live: hentikan task lokal

Supaya log forward tidak terpecah dua tempat, pilih **satu** sumber utama:

```powershell
# Hentikan automation lokal (log lama tetap tersimpan di logs\)
npm run task:unregister
```

Lalu biarkan GitHub Actions + Vercel Cron yang mengisi state Upstash.
Jika deployment gagal total, task lokal tetap valid sebagai bukti forward test
(penjadwal eksternal diperbolehkan; lihat `docs/CHECKLIST_UAS.md`).

---

## 7. Setelah 14 November 2026

```powershell
npm run history
npm run backtest
node scripts/export_logs.js        # butuh env Upstash
npm run recompute
npm run freeze
npm run dashboard
npm run verify
```

Lalu isi tabel forward di `REFLEKSI.md` dan commit hasilnya.

---

## 8. Catatan integritas

- `lib/indodax.js` diperbaiki pada 9 Nov 2026 (normalisasi `server_time` milidetik → detik).
  Ini **bug fix**, bukan perubahan aturan; lihat `docs/BUGFIX_LOG.md`.
  Hash gabungan aturan tetap `05739d63…483d7`.
- Timeframe tetap **4 jam**, `N=20`, `X=150`, universe 8 pair — tidak berubah.
- Tidak ada API key Indodax dan tidak ada order nyata di seluruh sistem.
