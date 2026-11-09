# Checklist Deliverable UAS

**Refa Maharani Imaniar · NIM 25110200011 · UAS Algoritma Trading**

Dokumen ini memetakan setiap requirement tugas ke implementasi, bukti file, dan status. Tujuannya agar penilaian tidak bergantung pada klaim di README, tetapi bisa dicek langsung ke kode dan artefak.

- **Status keseluruhan:** kode, backtest, dashboard, audit, dan freeze **selesai**.
- **Forward test:** **belum berjalan** karena deployment dilakukan oleh pemilik proyek (bukan asisten). Jendela sudah dibekukan; langkah deploy ada di bagian 4.
- **Deviasi yang disepakati:** forward test **6,37 hari** (8–14 November 2026), bukan 10 hari. Dicatat di README, STRATEGI, REFLEKSI, dan HASIL_BACKTEST.

---

## 1. Requirement utama

| # | Requirement | Implementasi | Bukti | Status |
|---:|---|---|---|---|
| 1 | Bot trading Indodax **dry-run** | `api/tick.js` + `lib/bot.js`; tidak ada order nyata, semua order `mode: "dry-run"` | `lib/bot.js`, `results/report.json` | **Selesai** |
| 2 | Hanya **API publik**, tanpa API key | `lib/indodax.js` memakai endpoint publik (`/api/pairs`, `tradingview/history_v2`, `/api/depth/{id}`) | `lib/indodax.js`; tidak ada private key di repo | **Selesai** |
| 3 | Timeframe **4 jam** | `tf=240`, label `4h`, 6 candle/hari | `config/frozen.json`, `config/universe.json` | **Selesai** |
| 4 | Universe **8 pair IDR paling likuid**, diukur di **awal** periode | `scripts/select_universe.js` memakai median nilai transaksi 30 hari pertama backtest | `config/universe.json`, `data/universe_candidates.json` | **Selesai** |
| 5 | **Beli di ask, jual di bid**, depth walk | Backtest: `open × (1 + spread/2 + slippage)`; live: `walkBuy(asks)` / `walkSell(bids)` | `lib/backtest.js`, `lib/fill.js` | **Selesai** |
| 6 | Fee **taker all-in** | Beli 0,20555%, jual 0,41555% (halaman resmi Pro, efektif 1 Okt 2026) | `config/frozen.json`, `HASIL_BACKTEST.md` §8 | **Selesai** |
| 7 | Minimum order **Rp25.000** | Entry ditolak/dilewati jika notional < Rp25.000 | `lib/backtest.js`, `lib/bot.js`; audit `bt.risk.min_order` | **Selesai** |
| 8 | Hanya candle **tertutup** | Sinyal memakai candle `s`; eksekusi di bar/tick `s+1`; candle berjalan tidak dipakai | `lib/strategy.js`, `lib/bot.js` | **Selesai** |
| 9 | **Validasi data** | Cek OHLC konsisten, volume > 0, gap, candle basi ≤ 2 bar, bid/ask ada, spread ≤ 2% | `lib/strategy.js`, `lib/bot.js`; `errors.jsonl` | **Selesai** |
| 10 | **Daily loss limit 3%** berbasis hari **WIB** | `wibDayKey` / `wibNextDayStart`; entry diblokir, exit tetap jalan | `lib/time.js`, `lib/bot.js`, `lib/backtest.js`; audit `bt.risk.daily_loss` | **Selesai** |
| 11 | **Kill switch** | Env `KILL_SWITCH=1` atau Redis key lewat `GET/POST /api/kill`; hanya memblokir entry | `api/kill.js`, `lib/bot.js` | **Selesai** |
| 12 | **Idempotensi per candle** | `state.lastProcessed[symbol]` + Redis lock `SET NX EX` per `symbol:candleTime` | `lib/bot.js`, `lib/store.js`; smoke test tick kedua = 0 order | **Selesai** |
| 13 | **Retry terbatas** | Maksimal 3 percobaan, backoff 400 ms / 1200 ms, timeout 12 detik | `lib/http.js` | **Selesai** |
| 14 | Endpoint tick dilindungi **CRON_SECRET** | Wajib `Authorization: Bearer <CRON_SECRET>` atau `?secret=`; tanpa secret 401 | `api/tick.js` | **Selesai** |
| 15 | **Backtest ≥ 3 tahun** | 8 Nov 2023 → 8 Nov 2026 = **3,0007 tahun**; 461 trade | `results/backtest_summary.json`, `HASIL_BACKTEST.md` | **Selesai** |
| 16 | Fungsi sinyal **sama** untuk bot & backtest | Satu implementasi `computeSignals` di `lib/strategy.js`, diimpor kedua mesin | `lib/strategy.js`, `lib/backtest.js`, `lib/bot.js` | **Selesai** |
| 17 | **Forward test** ~6 hari | Jendela beku 8 Nov 15:00 WIB → 14 Nov 23:59 WIB; 39 slot 4 jam | `config/frozen.json`, `.github/workflows/tick.yml` | **Menunggu deploy** |
| 18 | **Dashboard** online + offline | `public/index.html` + `app.js` + `data.js`; online `/api/dashboard`, offline `file://` | `public/`; 5 tab berfungsi, canvas chart tergambar | **Selesai** |
| 19 | **Log mentah** forward | `export_logs.js` → `logs/export/*.jsonl` + CSV + `manifest.json` | `scripts/export_logs.js` | **Menunggu forward** |
| 20 | **Skrip hitung ulang** | `scripts/recompute.js` menghitung ulang dari CSV/log, bukan dashboard | `results/recompute.json` | **Selesai** (backtest 19/19 PASS) |
| 21 | **Freeze + integritas** | `scripts/freeze.js` membuat manifest SHA-256; `--verify` menolak perubahan | `results/freeze_manifest.json`, `npm run verify`, `docs/BUGFIX_LOG.md` | **Selesai setelah commit** |
| 22 | **Deploy Vercel** | `vercel.json` (fungsi, rewrite, cron backup, header) | `vercel.json` | **Siap; pemilik deploy** |
| 23 | **Tick otomatis** | GitHub Actions tiap jam menit ke-7 UTC; Vercel Cron harian sebagai backup | `.github/workflows/tick.yml`, `vercel.json` | **Siap; pemilik isi secrets** |
| 24 | **Tanpa rahasia di repo** | `.env` di `.gitignore`; `.env.example` hanya placeholder | `.gitignore`, `.env.example` | **Selesai** |
| 25 | Dokumentasi strategi | `STRATEGI.md` (desain, eksekusi, biaya, keterbatasan) | `STRATEGI.md` | **Selesai** |
| 26 | Dokumentasi hasil | `HASIL_BACKTEST.md` (metrik, per tahun/bulan/pair, audit) | `HASIL_BACKTEST.md` | **Selesai** |
| 27 | Refleksi pribadi | `REFLEKSI.md` (proses, kesalahan, etika, rencana forward) | `REFLEKSI.md` | **Selesai** |

---

## 2. Bukti teknis yang bisa dicek cepat

| Klaim | Cara cek | Hasil yang diharapkan |
|---|---|---|
| Backtest 3 tahun | `node -e "const s=require('./results/backtest_summary.json'); console.log(s.backtest.window,s.backtest.metrics)"` | window 2023-11-08 → 2026-11-08; 461 trade; return 0,4355 |
| Audit backtest | `npm run recompute` | `overall_passed: true`; 19/19 PASS |
| Integritas freeze | `npm run verify` | `FREEZE UTUH.` |
| Smoke test entry/exit/idempotensi | `npm run smoke` | Entry di ask, tick kedua 0 order, exit di bid, kas rekonsiliasi |
| Dashboard offline | buka `public/index.html` | 5 tab tampil tanpa server; fallback `public/data.js` |
| Dashboard online | `GET /api/dashboard` setelah deploy | JSON laporan statis + live |
| Tick terproteksi | `curl` tanpa header ke `/api/tick` | HTTP 401 `tidak berwenang` |
| Candle hanya yang tertutup | `results/backtest_signals.csv` | `execute_time_utc` selalu > `signal_time_utc` |
| Minimum order | audit `bt.risk.min_order` | semua BUY ≥ Rp25.000 |
| Daily loss | audit `bt.risk.daily_loss` | 0 pelanggaran |

---

## 3. Hasil backtest (ringkas)

| Item | Hasil |
|---|---:|
| Periode | 2023-11-08 → 2026-11-08 (3,0007 tahun) |
| Ekuitas awal | Rp100.000.000 |
| Ekuitas akhir | **Rp143.553.628** |
| Return total | **+43,55%** |
| CAGR | **+12,80%** |
| Max drawdown | **−42,46%** |
| Trade / win rate | 461 / **18,22%** |
| Profit factor gross / net | 1,80 / 1,22 |
| Total biaya | **Rp68.777.915** (27,21% dari gross profit) |
| Benchmark BTCIDR | **+147,63%** |
| Alpha vs BTC | **−104,07 poin persentase** |
| Audit | **19/19 PASS** |

Interpretasi lengkap ada di `HASIL_BACKTEST.md` dan `STRATEGI.md` §8. Kesimpulan jujur: strategi **tidak mengalahkan BTC** dan drawdown terlalu besar untuk dana nyata; yang berhasil adalah membangun sistem yang bisa diaudit.

---

## 4. Yang masih harus dilakukan pemilik proyek

Asisten tidak melakukan deploy. Urutan ini harus dijalankan sendiri.

### 4.1 Sebelum/saat deploy (8 November 2026)

- [ ] Buat database **Upstash Redis** region Singapore; catat REST URL + token.
- [ ] Buat repo GitHub, push folder `indodax-dryrun`.
- [ ] Import repo ke **Vercel**; Root Directory `indodax-dryrun` bila perlu.
- [ ] Isi environment Vercel: `CRON_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `STORE=upstash`, `KILL_SWITCH=0`.
- [ ] Isi GitHub Actions secrets: `BOT_URL`, `CRON_SECRET` (sama).
- [ ] Buka `/api/health` dan `/`; pastikan dashboard tampil.
- [ ] Uji tick pertama:

  ```powershell
  $env:CRON_SECRET = "secret-yang-sama"
  curl.exe -H "Authorization: Bearer $env:CRON_SECRET" https://PROJECT.vercel.app/api/tick
  ```

  Sebelum 15:00 WIB: `{ "ok": true, "waiting": true }`.  
  Sesudah 15:00 WIB: `{ "ok": true, "processed": [...] }`.
- [ ] Biarkan GitHub Actions berjalan tiap jam sampai 14 November 23:59 WIB.

### 4.2 Setelah 14 November 2026

- [ ] Tunggu sampai **15 November 2026 03:00 WIB** agar candle 16:00 UTC 14 November tertutup.
- [ ] `npm run history`
- [ ] `npm run backtest` (mengisi `results/backtest_forward.json`)
- [ ] `node scripts/export_logs.js` dengan env Upstash (menghasilkan `logs/export/*`)
- [ ] `npm run recompute` (bagian forward harus `available: true`)
- [ ] `npm run freeze`
- [ ] `npm run dashboard`
- [ ] `npm run verify`
- [ ] Isi tabel forward di `REFLEKSI.md` §10 dan cek tab **Forward Test**.
- [ ] Commit hasil: `git add . && git commit -m "hasil forward test 8-14 Nov 2026 + audit" && git push`.

### 4.3 Kriteria forward test dianggap berhasil

Bukan dari return positif, tetapi dari:

- tidak ada order ganda untuk candle yang sama;
- semua candle dalam jendela diproses, atau alasannya dicatat;
- tidak ada entry saat kill switch/daily loss limit aktif;
- tidak ada order di bawah Rp25.000;
- kas + nilai posisi rekonsiliasi dengan ekuitas;
- log mentah lengkap dan bisa dihitung ulang;
- tidak ada rahasia yang bocor ke repo.

---

## 5. Deviasi dan keterbatasan yang diakui

| Deviasi | Alasan | Dicatat di |
|---|---|---|
| Forward **6,37 hari**, bukan 10 hari | Freeze 8 November, forward dihentikan 14 November sesuai arahan | README §9, STRATEGI §9.3, REFLEKSI §4.5, HASIL_BACKTEST §14 |
| Deployment bisa molor | Bot hanya memproses candle terbaru; candle sebelum deploy tidak diproses ulang. Coverage dihitung dari `calls.jsonl`, bukan `lastProcessed` | README §9, `lib/report.js` (`progressOf`) |
| Snapshot spread/slippage hanya **24 sampel** satu jendela waktu | Waktu terbatas sebelum freeze; floor 0,05% dipakai | README §4.3, STRATEGI §5.2, REFLEKSI §4.4 |
| Parameter **N=20/X=150 diwarisi**, tidak dioptimasi pada crypto | Menghindari overfitting pada satu rezim | STRATEGI §2.4, REFLEKSI §4.1 |
| Backtest **satu jalur historis**, tanpa Monte Carlo | Keterbatasan cakupan tugas | STRATEGI §9.2, HASIL_BACKTEST §12 |
| Fill backtest **satu level sintetis** | Live memakai depth walk nyata; selisih wajar | STRATEGI §4.2, HASIL_BACKTEST §12 |
| Tidak ada pajak/withdrawal/on-chain | Fokus pada fee taker spot IDR | STRATEGI §5.3 |
| **Tidak ada order nyata/API key** | Tugas dry-run; tidak ada dana | README §5, REFLEKSI §6 |

---

## 6. Struktur deliverable

```text
indodax-dryrun/
├─ api/                     # tick, dashboard, health, kill
├─ lib/                     # strategy (satu fungsi), bot, backtest, fill, store, report
├─ scripts/                 # universe, history, snapshot, backtest, recompute,
│                           # export, freeze, dashboard, smoke, tick_local
├─ config/                  # frozen.json, universe.json
├─ data/                    # candle 4h, spread, kandidat universe
├─ results/                 # backtest_*, recompute.json, report.json, freeze_manifest.json
├─ public/                  # dashboard offline/online (index.html, app.js, data.js, data/)
├─ logs/export/             # log mentah forward (setelah export)
├─ .github/workflows/tick.yml
├─ vercel.json
├─ .env.example
├─ README.md
├─ STRATEGI.md
├─ REFLEKSI.md
├─ HASIL_BACKTEST.md
└─ docs/CHECKLIST_UAS.md
```

---

## 7. Pernyataan integritas

- Tidak ada API key Indodax, tidak ada saldo, dan tidak ada order yang dikirim ke bursa.
- Tidak ada look-ahead: sinyal hanya dari candle tertutup; eksekusi di bar/tick berikutnya.
- Tidak ada parameter yang diubah setelah melihat hasil backtest.
- Hasil yang jelek (kalah dari BTC, MDD −42,46%, 32 loss beruntun) dilaporkan, bukan disembunyikan.
- Semua angka hasil bisa ditelusuri ke CSV/JSON dan dihitung ulang dengan `scripts/recompute.js`.
- Forward test yang belum berjalan tidak diklaim sebagai selesai; statusnya **menunggu deploy**.
