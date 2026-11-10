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
| Verifikasi | `npm run verify` → `Diverifikasi 31 file: 0 berubah, 0 hilang. FREEZE UTUH.` |

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
| Backtest jendela forward | `results/backtest_forward.json`, `results/backtest_summary.json` → `forward_backtest` |
| Data candle 4 jam | `data/candles/*_240.csv` |
| Snapshot order book | `logs/export/snapshots.csv`, `data/spread_samples.jsonl` |
| Catatan perbaikan pasca-freeze | `docs/BUGFIX_LOG.md` (BF-001…BF-007) |
| Checklist requirement | `docs/CHECKLIST_UAS.md` |

## Cara menjalankan ulang

```powershell
npm install
npm run verify      # cek integritas freeze
npm run recompute   # hitung ulang semua angka dari CSV/log
npm run smoke       # uji entry/exit/idempotensi
```

Dashboard offline: buka `public/index.html` langsung dengan browser (tanpa server).

## Deviasi yang dilaporkan terbuka

1. **Forward test 6,37 hari** (8 Nov 15.00 WIB → 14 Nov 23.59 WIB), bukan 10 hari.
   Freeze dilakukan 8 November, bukan 4 November.
2. **Cakupan candle di bawah 100%.** Tick pertama baru berjalan 9 Nov 04:37 UTC,
   sehingga candle 8 Nov–9 Nov tidak terproses dan tidak diisi ulang. Angka cakupan
   dilaporkan apa adanya di dashboard (`coverage_pct`), bukan diklaim 100%.
3. **Snapshot spread/slippage 24 sampel** sebelum freeze; floor 0,05% dipakai.

Deviasi ini juga tercatat di `README.md` §9, `STRATEGI.md` §9.3, `REFLEKSI.md`,
`HASIL_BACKTEST.md` §14, dan `docs/CHECKLIST_UAS.md` §5.
