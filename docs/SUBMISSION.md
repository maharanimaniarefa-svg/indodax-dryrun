# Catatan Pengumpulan UAS

**Nama:** Refa Maharani Imaniar
**NIM:** 25110200011
**Mata kuliah:** Algorithmic Trading (Trad1 & Trad2)
**Tenggat:** Sabtu, 14 November 2026, 23.59 WIB

## Tautan

| Item | Tautan |
|---|---|
| Dashboard (Vercel) | https://indodax-dryrun-uas-refa-maharani-tr.vercel.app |
| Health check | https://indodax-dryrun-uas-refa-maharani-tr.vercel.app/api/health |
| Repositori publik (riwayat commit lengkap) | https://github.com/maharanimaniarefa-svg/indodax-dryrun |

## Bukti freeze

| Item | Nilai |
|---|---|
| Waktu freeze | `2026-11-08T13:41:22+07:00` |
| Commit beku | `7fd8746` — `freeze-2026-11-08: bot dry-run Indodax + backtest 3 tahun` |
| Commit manifest | `4723293` — `freeze manifest SHA-256 + dashboard offline` |
| Manifest | `results/freeze_manifest.json` |
| Hash gabungan aturan | `05739d638487a99b4176ecc21cb447e4e706ebe8196771a414224c25f93483d7` (tidak berubah sejak 8 Nov) |
| Verifikasi | `npm run verify` → `Diverifikasi 31 file: 0 berubah, 0 hilang. FREEZE UTUH.` |

Manifest di-*rebaseline* setiap kali log forward diekspor ulang, mengikuti urutan
`export → recompute → freeze → dashboard`. Yang di-*rebaseline* hanya hash bukti
(log, `recompute.json`, hasil backtest); **hash aturan (`freeze_hash`) tetap sama**,
dan versi manifest lama tetap tersimpan di riwayat commit (`4723293`).

Riwayat commit **tidak** pernah di-force-push. Folder `.git` ikut di dalam ZIP ini
sebagai cadangan, sehingga bukti freeze bisa diperiksa tanpa internet.

## Peta deliverable ke soal UAS

| Yang diminta soal | Lokasi di paket ini |
|---|---|
| Source code bot + backtest + README | `api/`, `lib/`, `scripts/`, `README.md` |
| Strategi tertulis + perubahan dari UTS | `STRATEGI.md` |
| Commit freeze date (hash + waktu) | tabel di atas, `git log`, `results/freeze_manifest.json` |
| Log mentah forward (calls, orders, equity, errors, snapshot) | `logs/export/*.jsonl` dan `*.csv` |
| Skrip hitung ulang | `scripts/recompute.js` → `results/recompute.json` |
| Dashboard online | https://indodax-dryrun-uas-refa-maharani-tr.vercel.app |
| Dashboard HTML offline mandiri | `public/index.html` (+ `app.js`, `data.js`, `data/`) |
| Refleksi backtest vs forward | `REFLEKSI.md` §10 |
| `.env.example` tanpa rahasia | `.env.example` |
| Hasil backtest 3 tahun | `results/backtest_*.json`, `results/backtest_*.csv` |
| Backtest jendela forward | `results/backtest_forward.json`, `results/backtest_summary.json` → `forward_backtest` (dibuat saat finalisasi 14 Nov 2026, dari jendela yang sama dengan forward test) |
| Data candle 4 jam | `data/candles/*_240.csv` |
| Snapshot order book | `logs/export/snapshots.csv`, `data/spread_samples.jsonl` |
| Catatan perbaikan pasca-freeze | `docs/BUGFIX_LOG.md` (BF-001…BF-008) |
| Checklist requirement | `docs/CHECKLIST_UAS.md` |

## Catatan tampilan GitHub Actions

Halaman **Actions** menampilkan run berstatus merah pada 9–10 November 2026.
Itu bukan kegagalan bot: semua run tersebut berhenti karena secret `BOT_URL` dan
`CRON_SECRET` belum dipasang. Setelah secret dipasang pada 10 November 2026 07:18 UTC,
**65 dari 66 run berstatus success**. Satu run (11 Nov 21:29 UTC) berstatus gagal karena
job dibatalkan oleh infrastruktur GitHub sebelum satu pun step dijalankan; tick
berikutnya tetap sukses sehingga tidak ada data yang hilang. Penjelasan lengkap ada
di `docs/DEPLOY.md` §4.

## Kenapa log di ZIP adalah snapshot

`logs/export/` dan `public/data.js` di dalam ZIP adalah **potret pada saat ZIP dibangun**,
bukan data yang terus berubah. Sumber data live ada di Upstash Redis dan ditampilkan
oleh dashboard online. Karena itu jumlah `calls` di ZIP bisa lebih kecil daripada
dashboard online bila ZIP dibuka beberapa jam setelah dibangun — itu normal, bukan
data hilang dan bukan data ganda. Angka final di ZIP dibangun ulang pada
14 November 2026 setelah jendela forward berakhir.

Cara memeriksa konsistensinya: buka `logs/export/manifest.json` (ada `exported_at`,
`store`, dan jumlah baris), lalu bandingkan dengan `counters.calls` di
`/api/health` pada waktu yang sama.

## Cara menjalankan ulang

```powershell
npm install
npm run verify      # cek integritas freeze
npm run recompute   # hitung ulang semua angka dari CSV/log
npm run smoke       # uji entry/exit/idempotensi
```

Dashboard offline: buka `public/index.html` langsung dengan browser (tanpa server).

## Kepatuhan terhadap jadwal instruksi

| Item | Instruksi | Aktual | Selisih |
|---|---|---|---|
| Freeze aturan & parameter | 4 Nov 2026 12.00 WIB | 8 Nov 2026 13.41 WIB | +4 hari 1 jam |
| Awal forward test | 4 Nov 2026 12.00 WIB | 8 Nov 2026 15.00 WIB | +4 hari 3 jam |
| Akhir forward test | 14 Nov 2026 12.00 WIB | 14 Nov 2026 23.59 WIB | +11 jam 59 menit |
| Durasi forward | 10 hari | 6,37 hari | −3,63 hari |
| Bukti freeze | riwayat commit publik atau ZIP + `.git` | **keduanya** tersedia | sesuai |
| Pengumpulan | 14 Nov 2026 23.59 WIB | 14 Nov 2026 sebelum 23.59 WIB | sesuai |

**Sebab:** deployment Vercel + Upstash baru selesai 8 November 2026, bukan 4 November.
Repositori dibuat lokal sejak 8 November dan di-push ke GitHub pada 9 November
(timestamp commit tidak diubah). Secret penjadwal dipasang 10 November 07.18 UTC,
sehingga candle 8–9 November tidak teramati.

**Tanggal freeze tidak diubah**, karena mengubahnya akan menjadi fabrikasi dan membuat
bukti freeze tidak sah. Perbandingan backtest–forward memakai jendela aktual yang sama
(8 Nov 15.00 WIB → 14 Nov 23.59 WIB), sehingga tetap setara. Penjelasan lengkap ada di
`REFLEKSI.md` §12.

## Deviasi lain yang dilaporkan terbuka

1. **Cakupan candle di bawah 100%.** Penjadwal otomatis baru aktif penuh 10 November,
   sehingga candle 8–9 November tidak terproses dan tidak diisi ulang (agar tidak
   terjadi look-ahead bias). Angka cakupan dilaporkan apa adanya di dashboard
   (`coverage_pct`), bukan diklaim 100%.
2. **Snapshot spread/slippage 24 sampel** sebelum freeze; floor 0,05% dipakai.

Deviasi ini juga tercatat di `README.md` §9, `STRATEGI.md` §9.3, `REFLEKSI.md` §12,
`HASIL_BACKTEST.md` §14, dan `docs/CHECKLIST_UAS.md` §5.
