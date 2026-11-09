# Indodax Dry-Run Bot — Dual SMA 20/150

**UAS Algoritma Trading**  
Refa Maharani Imaniar · NIM 25110200011 · Kelas Algoritma Trading

Bot **dry-run** untuk pasar IDR Indodax dengan timeframe **4 jam**, backtest **3 tahun**, forward test, dashboard, log mentah, dan skrip audit. Tidak ada API key Indodax, tidak ada dana nyata, dan tidak ada order yang dikirim ke bursa. Semua eksekusi disimulasikan dari order book publik.

> **Status freeze:** `2026-11-08T13:41:22+07:00`  
> **Jendela forward:** `2026-11-08T08:00:00Z` → `2026-11-14T16:59:00Z`  
> **Commit beku:** `freeze-2026-11-08`

---

## 1. Ringkasan hasil backtest 3 tahun

Periode: **8 November 2023 00:00 UTC → 8 November 2026 00:00 UTC** (3,00 tahun).  
Modal awal: **Rp100.000.000**. Universe: **8 pair IDR** yang dipilih dari likuiditas awal periode.

| Metrik | Hasil |
|---|---:|
| Ekuitas akhir | **Rp143.553.628** |
| Return total | **+43,55%** |
| CAGR | **+12,80%** |
| Max drawdown | **−42,46%** |
| Calmar | 0,30 |
| Jumlah trade | **461** |
| Win rate | **18,22%** (84 menang / 377 kalah) |
| Profit factor (gross) | **1,80** |
| Profit factor (net) | 1,22 |
| Rata-rata untung | +20,48% (Rp2.855.695) |
| Rata-rata rugi | −3,14% (−Rp520.755) |
| Rata-rata hold | 175,7 jam |
| Total fee | Rp46.364.601 |
| Total biaya (fee + spread + slippage + lainnya) | **Rp68.777.915** |
| Porsi biaya / laba kotor | **27,21%** |
| Benchmark BTCIDR buy & hold | +147,63% (MDD −49,43%) |
| Alpha vs BTCIDR | −104,07% |
| Rata-rata eksposur | 33,15% dari ekuitas |
| Posisi terbuka di akhir | 0 |

**Cara membaca hasil ini dengan jujur:**

- Strategi **tidak mengalahkan buy & hold BTC** pada periode ini. Ini bukan kegagalan yang disembunyikan; ini konsekuensi strategi trend-following long-only yang hanya ikut tren dan sering di luar pasar (rata-rata eksposur 33%).
- Return positif datang dari **ekor kanan**: rata-rata untung +20,48% jauh lebih besar dari rata-rata rugi −3,14%. Win rate rendah (18%) adalah normal untuk trend-following.
- Ada **32 loss beruntun** dan drawdown −42,46%. Secara risk-adjusted, hasil ini belum cukup baik untuk dana nyata.
- Backtest memakai biaya **lebih mahal** dari yang tertera di `/api/pairs`: taker beli 0,20555% dan taker jual 0,41555% (halaman resmi Pro, efektif 1 Oktober 2026), minimum order Rp25.000, serta spread/slippage hasil snapshot order book.

Ringkasan per tahun:

| Tahun | Return |
|---|---:|
| 2023 (8 Nov–31 Des) | +13,13% |
| 2024 | +77,35% |
| 2025 | −8,96% |
| 2026 (1 Jan–8 Nov) | −21,40% |

Per-symbol, pair yang paling berkontribusi adalah **DOGEIDR** (+Rp26,7 juta dari 41 trade) dan **ETHIDR** (+Rp12,1 juta dari 50 trade). Pair yang paling mengurangi hasil adalah **TRXIDR** (−Rp6,0 juta dari 87 trade) dan **ADAIDR** (−Rp2,0 juta dari 57 trade). Angka lengkap ada di `HASIL_BACKTEST.md` dan `results/backtest_trades.csv`.

---

## 2. Aturan strategi

Nama: **Dual SMA Trend Following (MA20 cross-up + filter MA150)**.

```
Masuk  : Close[s] > SMA20[s]
         DAN Close[s-1] <= SMA20[s-1]        (cross-up)
         DAN Close[s] > SMA150[s]            (filter tren besar)

Keluar : Close[s] < SMA150[s]

Arah   : long-only
Sinyal : hanya dari candle 4 jam yang sudah tertutup
Eksekusi: tick pertama setelah candle s tutup
```

- **MA20** menangkap momentum jangka pendek.
- **MA150** menyaring tren besar; entry hanya saat harga di atas MA150, exit saat harga jatuh di bawah MA150.
- Tidak ada short selling. Pasar spot IDR Indodax memang long-only untuk strategi ini.
- Satu posisi per pair, maksimum **8 posisi** (satu per pair di universe).
- Alokasi **10% ekuitas per posisi** (maksimum eksposur 80%, menyisakan kas untuk fee/slippage).
- Kandidat diurutkan dari likuiditas 30 hari terakhir (180 bar 4 jam); kandidat paling likuid didahulukan.
- Batas likuiditas **5% dari rata-rata nilai transaksi harian**.
- Minimum order **Rp25.000** (ketentuan Pro, lebih ketat dari Rp10.000 di API).

Parameter N=20 dan X=150 **diwarisi dari pemilihan in-sample pada tugas sebelumnya** (Kompas100) dan **tidak dioptimasi ulang** pada data crypto 2023–2026. Ini penting untuk menghindari overfitting pada backtest yang dilaporkan. Penjelasan lengkap ada di `STRATEGI.md`.

---

## 3. Universe dan data

Universe dipilih **sebelum backtest**, memakai likuiditas **30 hari pertama periode backtest** (bukan volume hari ini), sehingga tidak ada survivorship bias. Kandidat berasal dari pair IDR dengan volume tinggi dan cakupan data yang cukup.

| Pair | Likuiditas awal (median nilai transaksi/hari) | Cakupan 4h | Bar pertama |
|---|---:|---:|---|
| BTCIDR | Rp3,46 miliar | 100% | 2023-10-05 |
| ETHIDR | Rp1,10 miliar | 100% | 2023-10-05 |
| SOLIDR | Rp899,5 juta | 100% | 2023-10-05 |
| XRPIDR | Rp851,9 juta | 100% | 2023-10-05 |
| DOGEIDR | Rp707,2 juta | 100% | 2023-10-05 |
| ADAIDR | Rp418,3 juta | 100% | 2023-10-05 |
| BNBIDR | Rp212,1 juta | 100% | 2023-10-05 |
| TRXIDR | Rp200,6 juta | 100% | 2023-10-05 |

Setiap pair memiliki **6.778 candle 4 jam** (2023-10-05 → 2026-11-08), cukup untuk warm-up MA150 dan backtest 3 tahun. Data diambil dari endpoint publik `tradingview/history_v2`; order book dari `/api/depth/{pair}`.

Validasi data yang dilakukan sebelum sinyal dipakai:

- candle harus **sudah tertutup** (bukan candle berjalan);
- tidak boleh ada **gap** yang melebihi toleransi;
- harga `open/high/low/close` harus positif dan konsisten (`high >= max(open, close)`, `low <= min(open, close)`);
- volume tidak nol;
- candle tidak boleh **basi** lebih dari 2 bar;
- order book harus punya bid dan ask;
- spread tidak boleh melebihi **2%**.

Jika salah satu validasi gagal, pair tersebut **tidak diproses** dan alasannya dicatat di `errors.jsonl` / `calls.jsonl`. Bot tidak memaksakan order pada data yang rusak.

---

## 4. Model eksekusi dan biaya

Backtest dan bot memakai **fungsi sinyal yang sama** (`lib/strategy.js`), sehingga tidak ada dua definisi sinyal yang bisa berbeda.

### 4.1 Harga eksekusi

- **Beli di ask**, **jual di bid**, bukan di mid atau close.
- Backtest: harga fill = `open bar berikutnya × (1 + setengah spread + slippage)`, dibulatkan ke atas sesuai `priceStep` pair.
- Live dry-run: **depth walk** nyata pada order book saat tick. Jika notional target tidak terpenuhi, qty dipotong ke likuiditas yang tersedia.
- Tidak ada look-ahead: sinyal candle `s` hanya memakai data sampai `s`; eksekusi terjadi di bar/tick berikutnya.

### 4.2 Fee

| Komponen | Tarif |
|---|---:|
| Taker beli | **0,20555%** |
| Taker jual | **0,41555%** |
| Taker `/api/pairs` (pembanding) | 0,20% |
| Minimum order dipakai | **Rp25.000** |
| Minimum order API | Rp10.000 |

Sumber: [Help Indodax — Rincian Biaya Transaksi](https://help.indodax.com/hc/id/articles/4416646599705-Rincian-Biaya-Transaksi-di-INDODAX), diakses 8 November 2026. Tarif halaman resmi lebih mahal dari `/api/pairs`; proyek ini memakai yang **lebih mahal** dan minimum order yang **lebih ketat** agar hasil tidak optimistis.

### 4.3 Spread dan slippage

Diukur dari **24 snapshot order book** (3 ronde × 8 pair) pada 8 November 2026 pukul 13.54–13.55 WIB, tepat sebelum jendela forward dimulai. Notional target = 10% × Rp100 juta = **Rp10 juta** per order.

| Pair | Spread dipakai | Slippage dipakai |
|---|---:|---:|
| BTCIDR | 0,050% | 0,050% |
| ETHIDR | 0,050% | 0,050% |
| SOLIDR | 0,050% | 0,050% |
| XRPIDR | 0,114% | 0,050% |
| DOGEIDR | 0,156% | 0,076% |
| ADAIDR | 0,277% | 0,050% |
| BNBIDR | 0,215% | 0,050% |
| TRXIDR | 0,380% | 0,050% |

Spread dan slippage mentah di bawah 0,05% dinaikkan ke **floor 0,05%** supaya backtest tidak memakai asumsi eksekusi sempurna. Angka ini diterapkan konservatif untuk seluruh periode 3 tahun, bukan hanya saat snapshot. Keterbatasan: snapshot hanya satu titik waktu; likuiditas 2023–2025 bisa berbeda. Ini diakui di `REFLEKSI.md`.

Rincian biaya backtest:

| Komponen | Nilai | Porsi |
|---|---:|---:|
| Fee taker | Rp46.364.601 | 67,4% |
| Spread | Rp13.773.102 | 20,0% |
| Slippage | Rp7.798.484 | 11,3% |
| Lainnya (pembulatan harga/qty) | Rp841.728 | 1,2% |
| **Total** | **Rp68.777.915** | 100% |

---

## 5. Kontrol risiko dan keamanan

| Kontrol | Implementasi |
|---|---|
| **Daily loss limit 3%** | Diukur dari ekuitas awal hari **WIB**. Jika PnL harian ≤ −3%, entry baru diblokir sampai 00.00 WIB berikutnya. Exit tetap berjalan. |
| **Kill switch** | Env `KILL_SWITCH=1` atau Redis key `indodax:killswitch=1`. Hanya memblokir entry; exit tetap jalan. Bisa diubah lewat `POST /api/kill`. |
| **Idempotensi per candle** | `state.lastProcessed[symbol]` + Redis lock `SET NX EX` per `symbol:candleTime`. Tick berulang tidak menggandakan order. |
| **Lock global** | Satu tick pada satu waktu, TTL 75 detik. |
| **Retry terbatas** | Maksimal 3 percobaan per request, backoff 400 ms/1200 ms, timeout 12 detik. |
| **Batas waktu tick** | Deadline 45 detik; pair yang belum diproses dicatat, tidak dipaksakan. |
| **Spread guard** | Order book dengan spread > 2% tidak dipakai untuk entry. |
| **Slippage guard** | Entry live ditolak jika fill ask > 1% di atas harga sinyal. |
| **Minimum order** | Rp25.000; order di bawahnya dilewati. |
| **Likuiditas** | Maksimal 5% dari rata-rata nilai transaksi harian 30 hari. |
| **Candle basi** | Maksimal 2 bar (8 jam) di belakang server time. |
| **Pair maintenance** | Pair dengan `is_maintenance`/`is_market_suspended` dilewati. |
| **Endpoint tick** | Wajib `Authorization: Bearer CRON_SECRET`; tanpa secret ditolak. |
| **Dashboard** | Publik read-only; bisa dikunci dengan `DASHBOARD_TOKEN`. |
| **Rahasia** | `.env` di-`.gitignore`; tidak ada API key Indodax sama sekali. |

**Tidak ada order nyata.** Tidak ada endpoint private, tidak ada API key, tidak ada saldo. Semua order diberi `mode: "dry-run"`.

---

## 6. Struktur proyek

```
indodax-dryrun/
├─ api/
│  ├─ tick.js              # GET/POST /api/tick  (wajib CRON_SECRET)
│  ├─ dashboard.js         # GET /api/dashboard (laporan statis + live)
│  ├─ health.js            # GET /api/health   (monitoring)
│  └─ kill.js              # GET/POST /api/kill (kill switch)
├─ config/
│  ├─ frozen.json          # parameter beku, fee, jendela, identitas
│  └─ universe.json        # 8 pair + likuiditas awal + step harga/qty
├─ lib/
│  ├─ strategy.js          # SATU fungsi sinyal untuk bot & backtest
│  ├─ backtest.js          # mesin backtest 3 tahun
│  ├─ bot.js               # logika tick live dry-run
│  ├─ fill.js              # depth walk bid/ask
│  ├─ indodax.js           # client API publik
│  ├─ store.js             # Upstash Redis / file store
│  ├─ report.js            # penyusun laporan dashboard
│  ├─ metrics.js           # metrik & drawdown
│  ├─ dataset.js, csv.js, time.js, http.js, config.js
├─ scripts/
│  ├─ select_universe.js   # pilih 8 pair dari likuiditas awal
│  ├─ fetch_history.js     # tarik/merge candle 4h
│  ├─ collect_snapshot.js  # snapshot order book
│  ├─ build_spread.js      # spread/slippage dari snapshot
│  ├─ backtest.js          # backtest 3 tahun + jendela forward
│  ├─ recompute.js         # audit independen dari CSV & log mentah
│  ├─ export_logs.js       # ekspor Upstash -> logs/export/*
│  ├─ build_dashboard.js   # results/report.json + public/data.js
│  ├─ freeze.js            # manifest SHA-256 + verifikasi
│  ├─ smoke_test.js        # uji entry/exit/idempotensi
│  └─ tick_local.js        # satu tick lokal (file store)
├─ public/                 # dashboard offline/online
├─ data/
│  ├─ candles/*.csv        # 6.778 bar per pair
│  ├─ spread.json          # spread/slippage terukur
│  ├─ spread_samples.jsonl # snapshot mentah
│  ├─ universe_candidates.json
│  └─ meta.json
├─ results/
│  ├─ backtest_full.json / backtest_summary.json
│  ├─ backtest_trades.csv / backtest_equity.csv / backtest_signals.csv
│  ├─ recompute.json
│  ├─ report.json
│  └─ freeze_manifest.json
├─ logs/export/            # log mentah forward (setelah export)
├─ .github/workflows/tick.yml
├─ vercel.json
├─ .env.example
├─ README.md
├─ STRATEGI.md
├─ REFLEKSI.md
└─ HASIL_BACKTEST.md
```

---

## 7. Menjalankan lokal

Prasyarat: **Node.js ≥ 20** (diuji Node 24.20.0), Git, PowerShell/Terminal. Tidak ada dependency npm; semua memakai modul bawaan Node dan `fetch`.

```powershell
cd indodax-dryrun

# 1. Pilih universe (sekali; hasilnya config/universe.json)
npm run universe

# 2. Tarik candle 3 tahun + warm-up (butuh internet)
npm run history

# 3. Ukur spread/slippage beberapa kali di jam berbeda (opsional tapi disarankan)
npm run snapshot -- --rounds=3 --gap=120000
npm run spread

# 4. Backtest 3 tahun + backtest jendela forward
npm run backtest

# 5. Audit independen + manifest freeze
npm run recompute
npm run freeze
npm run dashboard

# 6. Uji logika entry/exit/idempotensi tanpa data pasar nyata
npm run smoke
```

Dashboard offline:

```powershell
start public/index.html
```

Atau jalankan server statis lokal:

```powershell
node -e "const h=require('http'),f=require('fs'),p=require('path');h.createServer((q,s)=>{const x=p.join('public',q.url==='/'?'index.html':q.url.slice(1));f.readFile(x,(e,d)=>{if(e){s.statusCode=404;s.end('404');return}s.end(d)})}).listen(4173,()=>console.log('http://127.0.0.1:4173'))"
```

Satu tick lokal (di luar jendela forward, gunakan `--no-window` hanya untuk uji):

```powershell
$env:STORE = "file"
node scripts/tick_local.js --no-window
```

> Tick lokal memakai order book Indodax sungguhan, tetapi tetap **dry-run**. Jangan jalankan `--no-window` saat jendela forward sedang berjalan kecuali untuk uji; gunakan `/api/tick` di Vercel untuk data forward yang sah.

Semua perintah yang butuh Upstash bisa memakai `.env`:

```powershell
Copy-Item .env.example .env
# isi .env, lalu:
node --env-file=.env scripts/export_logs.js
```

---

## 8. Deploy (dilakukan oleh pemilik proyek)

Asisten tidak melakukan deploy. Langkah berikut harus dijalankan sendiri.

### 8.1 GitHub

```powershell
git init
git add .
git commit -m "freeze-2026-11-08: bot dry-run Indodax + backtest 3 tahun"
git branch -M main
git remote add origin https://github.com/USERNAME/indodax-dryrun.git
git push -u origin main
```

Jika repo memuat folder induk, atur **Root Directory** Vercel ke `indodax-dryrun`.

### 8.2 Upstash Redis

1. Buat database di [console.upstash.com](https://console.upstash.com).
2. Pilih region **Singapore / ap-southeast-1** agar dekat dengan Vercel `sin1`.
3. Buka **REST API** dan catat `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN`.

### 8.3 Vercel

1. **Add New → Project**, import repo GitHub.
2. Framework Preset: **Other**. Build Command: kosong. Output Directory: kosong (Vercel menyajikan `public/`).
3. Root Directory: `indodax-dryrun` bila perlu.
4. Environment Variables (Production):

```text
CRON_SECRET=<string acak panjang, mis. openssl rand -hex 32>
UPSTASH_REDIS_REST_URL=https://xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxxxxxxx
STORE=upstash
KILL_SWITCH=0
DASHBOARD_TOKEN=
```

5. Deploy. Cek:

```text
https://PROJECT.vercel.app/api/health
https://PROJECT.vercel.app/
```

`/api/health` harus `ok: true` setelah tick pertama (sebelum tick pertama, `stale` bisa true).

6. **Vercel Cron** sudah didefinisikan di `vercel.json`: `/api/tick` setiap hari pukul **01:07 UTC** (08:07 WIB). Vercel otomatis mengirim `Authorization: Bearer CRON_SECRET` jika env `CRON_SECRET` diisi. Ini hanya **backup**; tick utama dari GitHub Actions.

### 8.4 GitHub Actions (tick utama)

Di repo GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

```text
BOT_URL=https://PROJECT.vercel.app
CRON_SECRET=<sama dengan env Vercel>
```

Workflow `.github/workflows/tick.yml` berjalan **setiap jam pada menit ke-7 UTC** dan berhenti otomatis setelah 14 November 2026. Bisa dijalankan manual lewat **Actions → Indodax dry-run tick → Run workflow**.

### 8.5 Uji tick pertama

```powershell
$env:CRON_SECRET = "secret-yang-sama"
curl.exe -H "Authorization: Bearer $env:CRON_SECRET" https://PROJECT.vercel.app/api/tick
```

Respons normal sebelum jendela: `{ "ok": true, "waiting": true, ... }`.  
Sesudah 8 November 15:00 WIB: `{ "ok": true, "processed": [...], "equity": ..., ... }`.

Kill switch:

```powershell
# Aktifkan (blokir entry baru)
curl.exe -H "Authorization: Bearer $env:CRON_SECRET" "https://PROJECT.vercel.app/api/kill?active=1&reason=manual"

# Matikan
curl.exe -H "Authorization: Bearer $env:CRON_SECRET" "https://PROJECT.vercel.app/api/kill?active=0"
```

---

## 9. Prosedur forward test

Jendela beku: **8 November 2026 15:00 WIB → 14 November 2026 23:59 WIB** (6,37 hari; 39 slot candle 4 jam). Assignment meminta 10 hari, tetapi sesuai arahan dosen/pemilik proyek freeze dilakukan 8 November dan forward test dihentikan 14 November. Keterbatasan ini dicatat di `REFLEKSI.md`, bukan disembunyikan.

> **Penting jika deployment molor:** bot hanya memproses candle terbaru pada setiap tick. Candle yang sudah lewat sebelum deployment **tidak diproses ulang** (tidak ada order retroaktif). Dashboard menghitung coverage dari candle yang benar-benar tercatat di `calls.jsonl`, bukan dari `lastProcessed`, sehingga keterlambatan deployment terlihat jujur sebagai coverage < 100%. Deploy sedini mungkin agar mendekati 39 slot.

### Sebelum 8 November 15:00 WIB

1. Deploy Vercel + Upstash.
2. Isi secrets GitHub Actions.
3. Jalankan satu tick manual; pastikan `waiting: true` (belum masuk jendela) atau `ok: true`.
4. Buka dashboard dan `/api/health`.

### Selama 8–14 November

- Biarkan GitHub Actions berjalan tiap jam.
- Cek `/api/health` dan tab **Forward Test** di dashboard.
- Jangan mengubah `config/frozen.json`, `lib/strategy.js`, atau universe. Setelah commit freeze, perubahan apa pun akan terdeteksi `npm run verify`.
- Jika perlu menghentikan entry: `POST /api/kill?active=1`.

### Setelah 14 November 23:59 WIB

Tunggu sampai **15 November 2026 pukul 03:00 WIB (20:00 UTC)** atau lebih, supaya candle 16:00 UTC 14 November sudah tertutup dan ikut terbaca. Lalu:

```powershell
# 1. Tarik candle terbaru (termasuk candle terakhir jendela)
npm run history

# 2. Backtest ulang 3 tahun + backtest jendela forward yang sama
npm run backtest

# 3. Ekspor log mentah dari Upstash
$env:STORE = "upstash"
$env:UPSTASH_REDIS_REST_URL = "https://xxxxx.upstash.io"
$env:UPSTASH_REDIS_REST_TOKEN = "xxxxxxxx"
node scripts/export_logs.js

# 4. Audit independen dari CSV + log mentah
npm run recompute

# 5. Manifest final + dashboard dengan data live
npm run freeze
npm run dashboard

# 6. Cek integritas dan commit hasil
npm run verify
git add .
git commit -m "hasil forward test 8-14 Nov 2026 + audit"
git push
```

File yang dihasilkan:

- `logs/export/orders.jsonl` — order mentah (BUY/SELL, fill, fee, level depth).
- `logs/export/equity.jsonl` — mark-to-market tiap tick.
- `logs/export/calls.jsonl` — ringkasan tiap tick (sinyal, error, lock, kill switch).
- `logs/export/snapshots.jsonl` — snapshot order book tiap tick.
- `logs/export/*.csv` — versi tabel untuk dibaca manusia.
- `logs/export/manifest.json` — jumlah baris + SHA-256 tiap file.
- `results/recompute.json` — hasil audit independen (backtest + forward).
- `public/data.js` + `public/data/*` — dashboard offline dengan data live.

---

## 10. Audit dan integritas freeze

```powershell
npm run recompute   # hitung ulang dari CSV & log mentah, bukan dari angka dashboard
npm run verify      # cocokkan SHA-256 semua file beku
```

Hasil audit backtest: **19/19 check PASS**, termasuk:

- return, MDD, win rate, profit factor, jumlah trade, fee, dan total biaya cocok dengan hitungan ulang;
- jumlah trade/equity di CSV cocok dengan JSON;
- fee setiap order = notional × tarif taker;
- `netPnl = grossPnl − biaya` untuk setiap trade;
- tidak ada entry setelah daily loss limit aktif;
- semua order beli ≥ Rp25.000.

`results/recompute.json` juga memuat bagian `forward` yang otomatis berisi `available: false` sebelum ada log live, lalu terisi setelah `export_logs.js` dijalankan.

`results/freeze_manifest.json` memuat SHA-256 untuk:

- `config/frozen.json`, `config/universe.json`;
- `lib/config.js`, `lib/strategy.js`, `lib/backtest.js`, `lib/bot.js`, `lib/fill.js`, `lib/metrics.js`, `lib/indodax.js`, `lib/store.js`;
- `data/spread.json`, `data/meta.json`, `data/universe_candidates.json`, 8 file candle;
- `results/backtest_*`, `results/recompute.json`;
- `logs/export/*` bila sudah ada.

`npm run verify` akan menolak jika ada file aturan/data yang berubah setelah freeze. Perubahan setelah freeze harus disengaja dan didokumentasikan; untuk tugas ini, aturan strategi tidak diubah.

---

## 11. Endpoint

| Endpoint | Metode | Auth | Fungsi |
|---|---|---|---|
| `/api/tick` | GET/POST | `Bearer CRON_SECRET` | Satu tick bot dry-run. Idempoten per candle. |
| `/api/dashboard` | GET | publik, opsional `DASHBOARD_TOKEN` | Laporan JSON statis + live. `?section=static` / `?section=live`. |
| `/api/health` | GET | publik | Status store, umur tick, kill switch, phase. |
| `/api/kill` | GET/POST | `Bearer CRON_SECRET` | Aktifkan/matikan kill switch Redis. |
| `/` | GET | publik | Dashboard. |

Dashboard juga bekerja **offline** lewat `public/index.html` + `public/data.js`, tanpa server dan tanpa internet. Saat dibuka dari Vercel, dashboard mencoba `/api/dashboard` untuk data live; jika gagal, memakai laporan tertanam.

---

## 12. Batasan dan kejujuran akademik

1. **Forward test hanya 6,37 hari**, bukan 10 hari. Ini deviasi yang disepakati; dicatat di `REFLEKSI.md`.
2. **Strategi kalah dari buy & hold BTC** pada 2023–2026 (+43,55% vs +147,63%), meskipun drawdown lebih kecil (−42,46% vs −49,43%).
3. **Max drawdown −42,46%** terlalu besar untuk dana nyata. Position sizing 10% per posisi tidak cukup menahan drawdown portofolio saat semua pair turun bersamaan.
4. **Win rate 18,22%** dan **32 loss beruntun**. Secara psikologis sulit dijalankan tanpa disiplin.
5. **Spread/slippage hanya diukur pada satu titik waktu** (8 November 2026). Kondisi likuiditas 2023–2025 bisa berbeda. Floor 0,05% dipakai untuk mengurangi optimisme, tetapi ini bukan model mikrostruktur penuh.
6. **Backtest mengasumsikan fill penuh** pada depth walk backtest (satu level sintetis). Live dry-run memakai depth walk nyata, sehingga hasil live dan backtest bisa berbeda.
7. **Tidak ada order nyata**, tidak ada API key, dan tidak ada biaya withdrawal/on-chain. Ini murni simulasi akademik.
8. **Parameter tidak dioptimasi pada data crypto**. Ini mengurangi overfitting, tetapi juga berarti parameter mungkin bukan yang terbaik untuk crypto.
9. **Data candle berasal dari API publik** yang bisa memiliki gap/outlier. Validasi menolak data buruk, tetapi tidak menghilangkan risiko data vendor.
10. **Tidak ada jaminan performa masa depan.** Laporan ini bukan saran investasi.

---

## 13. Checklist deliverable UAS

| Deliverable | Bukti |
|---|---|
| Kode bot | `api/`, `lib/bot.js`, `lib/indodax.js`, `lib/store.js` |
| Backtest ≥ 3 tahun | `results/backtest_full.json`, `backtest_trades.csv`, `backtest_equity.csv`, `HASIL_BACKTEST.md` |
| Forward test | `logs/export/*` setelah 14 November; dashboard tab **Forward Test** |
| Dashboard | `public/index.html`, `public/app.js`, `public/style.css`; online `/` dan `/api/dashboard` |
| Log mentah | `logs/export/*.jsonl` + `manifest.json` |
| Skrip hitung ulang | `scripts/recompute.js`, `results/recompute.json` |
| Strategi | `STRATEGI.md` |
| Refleksi | `REFLEKSI.md` |
| Freeze & integritas | `results/freeze_manifest.json`, `npm run verify` |
| Deployment | `vercel.json`, `.github/workflows/tick.yml`, `.env.example` |
| Keamanan | `CRON_SECRET`, kill switch, `.gitignore`, tanpa API key |

Detail requirement-per-requirement ada di `docs/CHECKLIST_UAS.md`.

---

## 14. Perintah referensi

| Perintah | Fungsi |
|---|---|
| `npm run universe` | Pilih 8 pair dari likuiditas awal |
| `npm run history` | Tarik/merge candle 4h |
| `npm run snapshot -- --rounds=3 --gap=120000` | Ambil snapshot order book |
| `npm run spread` | Hitung spread/slippage |
| `npm run backtest` | Backtest 3 tahun + jendela forward |
| `npm run recompute` | Audit independen |
| `npm run freeze` | Buat manifest SHA-256 |
| `npm run verify` | Verifikasi freeze |
| `npm run dashboard` | Bangun `results/report.json` + `public/data.js` |
| `npm run smoke` | Uji entry/exit/idempotensi |
| `npm run tick -- --no-window` | Satu tick lokal (uji) |
| `npm run export` | Ekspor log Upstash ke `logs/export` |
| `npm run audit` | Recompute + verify |
| `npm run all` | Backtest → recompute → freeze → dashboard |

---

**Disclaimer:** proyek ini dibuat untuk tugas akademik Algoritma Trading. Bukan rekomendasi investasi. Performa masa lalu tidak menjamin hasil masa depan.
