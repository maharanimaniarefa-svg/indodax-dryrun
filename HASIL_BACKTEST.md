# Hasil Backtest 3 Tahun

**Refa Maharani Imaniar · NIM 25110200011 · UAS Algoritma Trading**

Dokumen ini adalah deliverable angka. Metodologi dan alasan desain ada di `STRATEGI.md`; refleksi proses ada di `REFLEKSI.md`; pemetaan requirement ada di `docs/CHECKLIST_UAS.md`.

- **Strategi:** Dual SMA Trend Following (MA20 cross-up + filter MA150), long-only.
- **Timeframe:** 4 jam.
- **Periode backtest:** 8 November 2023 00:00 UTC → 8 November 2026 00:00 UTC (3,00 tahun).
- **Modal awal:** Rp100.000.000.
- **Status hasil:** dihasilkan 8 November 2026 13:55 WIB, sebelum forward test dimulai.
- **Sumber angka:** `results/backtest_summary.json`, `results/backtest_full.json`, `results/backtest_trades.csv`, `results/backtest_equity.csv`, `results/recompute.json`.

> **Ringkasan satu baris:** strategi menghasilkan **+43,55%** dalam 3 tahun (CAGR **12,80%**), tetapi kalah dari buy & hold BTCIDR (**+147,63%**) dan mengalami drawdown **−42,46%**. Ini bukan strategi yang siap dipakai dengan dana nyata.

---

## 1. Metrik utama

| Metrik | Hasil |
|---|---:|
| Ekuitas awal | Rp100.000.000 |
| Ekuitas akhir | **Rp143.553.628** |
| Total return | **+43,55%** |
| CAGR | **+12,80%** |
| Max drawdown (MDD) | **−42,46%** |
| Calmar (CAGR / MDD) | 0,30 |
| Jumlah trade | **461** |
| Trade menang / kalah | **84 / 377** |
| Win rate | **18,22%** |
| Profit factor (gross) | **1,80** |
| Profit factor (net) | 1,22 |
| Rata-rata untung | +20,48% (Rp2.855.695) |
| Rata-rata rugi | −3,14% (−Rp520.755) |
| Rasio rata-rata untung : rugi | 6,53× |
| Rata-rata holding period | 175,7 jam (7,32 hari) |
| Rata-rata eksposur | 33,15% dari ekuitas |
| Waktu punya posisi | 77,12% bar (minimal satu posisi) |
| Total fee | Rp46.364.601 |
| Total biaya (fee + spread + slippage + lainnya) | **Rp68.777.915** |
| Porsi biaya / laba kotor | **27,21%** |
| Posisi terbuka di akhir | 0 |
| Pair yang dilewati karena data/order book | 0 |

**Laba bruto sebelum biaya** (total gross profit − total gross loss) = **Rp112.331.542**. Setelah biaya Rp68.777.915, laba bersih menjadi Rp43.553.628. Dengan kata lain, **61,23% dari laba bruto habis oleh biaya**; yang tersisa hanya 38,77%.

---

## 2. Konfigurasi yang diuji

| Komponen | Nilai |
|---|---|
| Universe | 8 pair IDR: BTCIDR, ETHIDR, SOLIDR, XRPIDR, DOGEIDR, ADAIDR, BNBIDR, TRXIDR |
| Pemilihan universe | Median nilai transaksi 30 hari **pertama** periode backtest (point-in-time) |
| Entry | `Close[s] > SMA20[s]` DAN `Close[s-1] <= SMA20[s-1]` DAN `Close[s] > SMA150[s]` |
| Exit | `Close[s] < SMA150[s]` |
| Arah | Long-only |
| Ukuran posisi | 10% ekuitas saat entry |
| Maksimum posisi | 8 (satu per pair) |
| Batas likuiditas | 5% dari rata-rata nilai transaksi harian 30 hari |
| Minimum order | Rp25.000 |
| Fee beli (taker all-in) | 0,20555% |
| Fee jual (taker all-in) | 0,41555% |
| Spread / slippage | Hasil snapshot order book per pair, floor 0,05% |
| Eksekusi | Beli di ask, jual di bid; backtest memakai open bar berikutnya |
| Warm-up | 200 bar; data candle dimulai 5 Oktober 2023 |
| Benchmark | Buy & hold BTCIDR, tanpa biaya |
| Parameter | N=20, X=150, diwarisi dari tugas in-sample sebelumnya; **tidak dioptimasi ulang** |

Detail beku ada di `config/frozen.json` dan `config/universe.json`.

---

## 3. Universe dan likuiditas awal

| Pair | Median nilai transaksi/hari (30 hari pertama) | Cakupan candle 4h | Bar pertama |
|---|---:|---:|---|
| BTCIDR | Rp3.464.516.293 | 100% | 2023-10-05 |
| ETHIDR | Rp1.101.824.282 | 100% | 2023-10-05 |
| SOLIDR | Rp899.508.211 | 100% | 2023-10-05 |
| XRPIDR | Rp851.897.501 | 100% | 2023-10-05 |
| DOGEIDR | Rp707.208.267 | 100% | 2023-10-05 |
| ADAIDR | Rp418.321.626 | 100% | 2023-10-05 |
| BNBIDR | Rp212.078.063 | 100% | 2023-10-05 |
| TRXIDR | Rp200.556.355 | 100% | 2023-10-05 |

Semua pair memiliki **6.778 candle 4 jam** pada data yang dipakai. Pemilihan memakai likuiditas awal, bukan volume 2026, untuk mengurangi survivorship/look-ahead bias.

---

## 4. Return per tahun dan per bulan

### 4.1 Per tahun (perubahan ekuitas)

| Tahun | Ekuitas akhir tahun | Return |
|---|---:|---:|
| 2023 (8 Nov–31 Des) | Rp113.129.833 | **+13,13%** |
| 2024 | Rp200.631.287 | **+77,35%** |
| 2025 | Rp182.645.959 | **−8,96%** |
| 2026 (1 Jan–8 Nov) | Rp143.553.628 | **−21,40%** |

### 4.2 Per bulan

| Bulan | Return | Bulan | Return |
|---|---:|---|---:|
| 2023-11 | −2,27% | 2025-04 | −0,05% |
| 2023-12 | +15,76% | 2025-05 | +0,85% |
| 2024-01 | −5,35% | 2025-06 | −1,91% |
| 2024-02 | +18,54% | 2025-07 | +17,43% |
| 2024-03 | +17,74% | 2025-08 | −0,43% |
| 2024-04 | −9,66% | 2025-09 | −2,76% |
| 2024-05 | −0,87% | 2025-10 | −4,91% |
| 2024-06 | −1,90% | 2025-11 | −1,85% |
| 2024-07 | −0,86% | 2025-12 | −4,55% |
| 2024-08 | −5,43% | 2026-01 | −2,72% |
| 2024-09 | +0,80% | 2026-02 | −0,25% |
| 2024-10 | +2,85% | 2026-03 | −5,83% |
| **2024-11** | **+65,68%** | 2026-04 | +1,20% |
| 2024-12 | −5,10% | 2026-05 | −0,04% |
| 2025-01 | −3,61% | 2026-06 | −1,59% |
| 2025-02 | −3,39% | 2026-07 | −4,37% |
| 2025-03 | −2,40% | 2026-08 | −2,17% |
|  |  | 2026-09 | −0,90% |
|  |  | 2026-10 | −6,32% |
|  |  | 2026-11 | −0,53% |

- **9 dari 37 bulan positif** (24,3%).
- Bulan terbaik: **November 2024 +65,68%**.
- Bulan terburuk: **April 2024 −9,66%**.
- Hampir seluruh keuntungan 3 tahun berasal dari satu episode tren besar pada November–Desember 2024. Tanpa November 2024, hasil jauh lebih biasa. Ini konsentrasi yang harus jujur disebut.

---

## 5. Distribusi trade

| Statistik | Nilai |
|---|---:|
| Total trade | 461 |
| Menang | 84 (18,22%) |
| Kalah | 377 (81,78%) |
| Rata-rata return trade menang | +20,48% |
| Rata-rata return trade kalah | −3,14% |
| Rata-rata PnL trade menang | +Rp2.855.695 |
| Rata-rata PnL trade kalah | −Rp520.755 |
| Rata-rata holding period | 175,7 jam |
| Loss beruntun terpanjang | **32 trade** |
| Win beruntun terpanjang | 7 trade |
| Total gross profit | Rp252.801.369 |
| Total gross loss | Rp140.469.827 |
| Total laba bruto | Rp112.331.542 |

Distribusinya **right-skewed**: sebagian besar trade rugi kecil, sedikit trade menang sangat besar. Ini ciri trend-following, bukan bug. Tetapi 32 loss beruntun membuat strategi ini sulit dijalankan secara psikologis.

### 5.1 Lima trade terbaik

| Pair | Entry → Exit (UTC) | Net PnL | Return |
|---|---|---|---:|---:|
| DOGEIDR | 2024-10-11 → 2024-12-10 | +Rp32.268.637 | +272,68% |
| ADAIDR | 2024-11-06 → 2024-12-10 | +Rp23.435.526 | +175,93% |
| XRPIDR | 2024-11-19 → 2024-12-20 | +Rp14.582.189 | +80,86% |
| BNBIDR | 2025-08-06 → 2025-10-17 | +Rp8.231.230 | +39,85% |
| BNBIDR | 2024-02-11 → 2024-04-02 | +Rp8.145.075 | +74,99% |

### 5.2 Lima trade terburuk

| Pair | Entry → Exit (UTC) | Net PnL | Return |
|---|---|---|---:|---:|
| DOGEIDR | 2025-09-14 → 2025-09-22 | −Rp2.951.803 | −13,69% |
| SOLIDR | 2025-01-22 → 2025-02-01 | −Rp2.770.603 | −13,95% |
| ADAIDR | 2025-03-04 → 2025-03-09 | −Rp2.392.363 | −12,80% |
| ADAIDR | 2026-08-06 → 2026-08-14 | −Rp2.368.844 | −14,99% |
| ADAIDR | 2025-05-13 → 2025-05-18 | −Rp2.359.170 | −12,11% |

Kerugian terbesar (−Rp2,95 juta) masih jauh lebih kecil dari keuntungan terbesar (+Rp32,27 juta). Rasio ini yang menopang strategi, bukan win rate.

---

## 6. Kontribusi per pair

Net PnL per pair bersifat aditif dan jumlahnya sama dengan total net PnL Rp43.553.628. Kolom “rata-rata return/trade” adalah rata-rata aritmetika yang tidak memperhitungkan ukuran posisi, sehingga tidak dijumlahkan menjadi return portofolio.

| Pair | Trade | Menang / Kalah | Win rate | Rata-rata return/trade | Rata-rata hold | Net PnL | Porsi net |
|---|---:|---:|---:|---:|---:|---:|---:|
| **DOGEIDR** | 41 | 9 / 32 | 21,95% | +6,76% | 219,2 jam | **+Rp26.712.171** | **61,33%** |
| **ETHIDR** | 50 | 10 / 40 | 20,00% | +1,49% | 195,0 jam | **+Rp12.132.961** | **27,86%** |
| SOLIDR | 54 | 15 / 39 | 27,78% | +1,59% | 200,4 jam | +Rp8.003.490 | 18,38% |
| BNBIDR | 72 | 13 / 59 | 18,06% | +0,63% | 181,6 jam | +Rp3.282.474 | 7,54% |
| BTCIDR | 46 | 9 / 37 | 19,57% | +1,06% | 238,5 jam | +Rp2.367.956 | 5,44% |
| XRPIDR | 54 | 7 / 47 | 12,96% | −0,29% | 134,4 jam | −Rp920.002 | −2,11% |
| ADAIDR | 57 | 9 / 48 | 15,79% | +0,85% | 130,2 jam | −Rp1.981.657 | −4,55% |
| **TRXIDR** | 87 | 12 / 75 | 13,79% | −0,30% | 146,0 jam | **−Rp6.043.769** | **−13,88%** |

Catatan penting:

- **DOGEIDR + ETHIDR = 89,19% dari total net PnL.** Hasil sangat terkonsentrasi pada dua pair.
- Tanpa DOGEIDR, total net PnL turun dari Rp43,55 juta menjadi **Rp16,84 juta**.
- TRXIDR adalah penyumbang negatif terbesar: 87 trade, win rate 13,79%, net −Rp6,04 juta. Frekuensi tinggi tidak otomatis menghasilkan laba; whipsaw dan biaya lebih besar.
- ADAIDR punya rata-rata return per trade positif (+0,85%) tetapi net PnL negatif (−Rp1,98 juta). Penyebabnya: ukuran posisi dan urutan trade tidak seragam, sehingga rata-rata persentase sederhana menyesatkan. Angka yang dipakai untuk kesimpulan adalah **net PnL**, bukan rata-rata persentase.

---

## 7. Kurva ekuitas dan drawdown

| Titik | Tanggal | Ekuitas |
|---|---|---:|
| Mulai | 2023-11-08 | Rp100.000.000 |
| Akhir 2023 | 2023-12-31 | Rp113.129.833 |
| Akhir 2024 | 2024-12-31 | Rp200.631.287 |
| Puncak ekuitas | **2024-12-04** | **Rp249.476.183** |
| Akhir 2025 | 2025-12-31 | Rp182.645.959 |
| Palung drawdown | **2026-11-02** | **Rp143.553.628** |
| Akhir backtest | 2026-11-08 | Rp143.553.628 |

- **MDD −42,46%** dari puncak Rp249,48 juta (4 Desember 2024) ke Rp143,55 juta (2 November 2026).
- Drawdown berlangsung hampir **23 bulan** dan **belum pulih** sampai akhir periode.
- Puncak Desember 2024 terjadi saat **8 posisi terbuka dan kas 0** (ekuitas = nilai posisi). Position sizing 10% per entry tidak mencegah eksposur 100% setelah posisi naik bersamaan. Ini memperbesar drawdown saat pasar berbalik.
- Rata-rata eksposur hanya **33,15%**, tetapi eksposur maksimum bisa mencapai **100%** pada kondisi tersebut.
- Daily loss limit 3% aktif dan memblokir entry pada **54 bar** dari 6.577 bar. Exit tetap berjalan. Tidak ada pelanggaran aturan ini menurut audit.

---

## 8. Biaya

| Komponen | Nilai | Porsi dari total biaya |
|---|---:|---:|
| Fee taker | Rp46.364.601 | 67,41% |
| Spread | Rp13.773.102 | 20,03% |
| Slippage | Rp7.798.484 | 11,34% |
| Lainnya (pembulatan harga/qty) | Rp841.728 | 1,22% |
| **Total biaya** | **Rp68.777.915** | **100%** |

- Total biaya setara **27,21% dari gross profit** (Rp252,80 juta) dan **61,23% dari laba bruto sebelum biaya** (Rp112,33 juta).
- Fee adalah komponen terbesar. Strategi melakukan 461 trade; setiap trade membayar fee beli + jual, ditambah spread dan slippage.
- Sensitivitas aritmetika: jika biaya dua kali lipat (tanpa mengubah harga/holding), laba bruto Rp112,33 juta − 2 × Rp68,78 juta ≈ **−Rp25,23 juta**. Ini bukan backtest terpisah, hanya ilustrasi bahwa margin strategi tipis terhadap biaya.

---

## 9. Benchmark BTCIDR

| Metrik | Strategi | BTCIDR buy & hold |
|---|---:|---:|
| Total return | +43,55% | **+147,63%** |
| CAGR | +12,80% | +35,28% |
| Max drawdown | −42,46% | −49,43% |
| Calmar | 0,30 | 0,71 |
| Biaya | Rp68,78 juta | Tidak dimodelkan |

- Strategi **kalah 104,07 poin persentase** dari BTC.
- Drawdown strategi lebih kecil **6,97 poin persentase**, tetapi tidak cukup untuk mengompensasi underperformance.
- Benchmark tidak memakai biaya dan bukan portofolio yang bisa diperdagangkan persis; fungsinya hanya sebagai pembanding pasif.

**Kesimpulan jujur:** pada periode ini, aturan trend-following long-only tidak menambah nilai dibanding memegang BTC. Yang lebih baik adalah drawdown yang sedikit lebih rendah, bukan return.

---

## 10. Audit independen

`scripts/recompute.js` membaca CSV trade/equity dan log mentah, lalu menghitung ulang metrik tanpa memakai angka dashboard sebagai input.

| Kelompok pemeriksaan | Hasil |
|---|---|
| Return, MDD, win rate, profit factor, jumlah trade | PASS |
| Fee dan total biaya | PASS |
| Jumlah trade/equity di CSV vs JSON | PASS |
| Fee setiap order = notional × tarif taker | PASS |
| `netPnl = grossPnl − biaya` untuk setiap trade | PASS |
| Urutan waktu trade | PASS |
| Tidak ada entry saat daily loss limit aktif | PASS |
| Semua order beli ≥ Rp25.000 | PASS |
| **Total** | **19/19 PASS** (`overall_passed: true`) |

Bagian `forward` di `results/recompute.json` masih `available: false` karena log live belum ada. Bagian itu akan terisi setelah `export_logs.js` dijalankan pasca-forward test.

---

## 11. Interpretasi: apakah hipotesis didukung?

**Sebagian.**

Yang mendukung:

1. Distribusi return memang right-skewed: 84 trade menang rata-rata +20,48%, sedangkan 377 trade kalah rata-rata hanya −3,14%.
2. Profit factor gross 1,80 menunjukkan ada edge bruto sebelum biaya.
3. Ada periode tren besar yang ditangkap: 2024 +77,35%, dengan November 2024 +65,68%.
4. Filter MA150 berhasil menjaga strategi tetap long-only pada tren besar dan keluar saat tren rusak; drawdown lebih kecil dari BTC.

Yang tidak mendukung:

1. Setelah biaya, profit factor net hanya **1,22**. Edge bruto sebagian besar habis oleh biaya.
2. MDD **−42,46%** terlalu besar untuk dana nyata. Calmar 0,30 rendah.
3. 2025 (−8,96%) dan 2026 YTD (−21,40%) negatif. Strategi tidak kebal rezim pasar.
4. Return sangat terkonsentrasi: November 2024 dan dua pair (DOGEIDR, ETHIDR).
5. Win rate 18,22% dengan 32 loss beruntun sulit dijalankan secara psikologis.
6. Strategi kalah jauh dari buy & hold BTC (+43,55% vs +147,63%).

Karena itu, hasil ini **tidak cukup** untuk menyimpulkan strategi layak dipakai dengan uang nyata. Yang bisa disimpulkan: sistem berjalan sesuai aturan, biaya dihitung konservatif, dan hasilnya bisa diaudit. Itu tujuan akademik proyek ini.

---

## 12. Keterbatasan yang memengaruhi angka

1. **Snapshot spread/slippage hanya satu jendela waktu** (8 November 2026, 24 snapshot). Likuiditas 2023–2025 bisa berbeda. Floor 0,05% dipakai, tetapi bukan model mikrostruktur penuh.
2. **Backtest mengasumsikan fill penuh** pada satu level sintetis (open ± spread/2 ± slippage). Live dry-run memakai depth walk nyata; hasil bisa berbeda.
3. **Tidak ada antrean order, latency, partial fill, atau kegagalan API** dalam model backtest.
4. **Daily loss memakai close bar**, bukan intrabar. Drawdown intrabar bisa lebih dalam dari yang tercatat.
5. **Tidak ada pajak, withdrawal, atau biaya on-chain.**
6. **Satu jalur historis**, bukan distribusi kemungkinan. Tidak ada Monte Carlo atau walk-forward optimization.
7. **Parameter diwarisi** dari tugas in-sample sebelumnya dan tidak dioptimasi pada crypto. Ini mengurangi overfitting, tetapi parameter mungkin bukan yang terbaik untuk crypto.
8. **Universe dipilih dari pair yang masih ada dan punya data 3 tahun.** Survivorship bias berkurang, tetapi tidak hilang sepenuhnya.
9. **Forward test hanya 6,37 hari** (39 slot 4 jam), bukan 10 hari. Untuk forward, yang dinilai adalah kepatuhan proses, bukan profitabilitas.
10. **Tidak ada jaminan performa masa depan.** Dokumen ini bukan saran investasi.

---

## 13. Reproduksi

```powershell
# dari folder indodax-dryrun
npm run history      # tarik/merge candle 4h
npm run backtest     # backtest 3 tahun + jendela forward
npm run recompute    # audit independen dari CSV/log
npm run freeze       # manifest SHA-256
npm run dashboard    # results/report.json + public/data.js
npm run verify       # pastikan file beku tidak berubah
```

Artefak yang bisa diperiksa:

| Artefak | Isi |
|---|---|
| `results/backtest_summary.json` | ringkasan metrik, universe, biaya, benchmark, monthly returns |
| `results/backtest_full.json` | 461 trade, 922 order, 6.577 titik ekuitas, config, sinyal |
| `results/backtest_trades.csv` | satu baris per trade, termasuk fee/spread/slippage dan net PnL |
| `results/backtest_equity.csv` | ekuitas, kas, nilai posisi, jumlah posisi per bar |
| `results/backtest_signals.csv` | sinyal entry/exit per pair per candle |
| `results/recompute.json` | 19 pemeriksaan independen + status forward |
| `results/report.json` | laporan yang dipakai dashboard |
| `public/data.js` | laporan tertanam untuk dashboard offline |

---

## 14. Status forward test

Forward test **belum berjalan** saat dokumen ini dibuat. Penyebabnya: deployment Vercel + Upstash + GitHub Actions dilakukan oleh pemilik proyek, bukan oleh asisten.

- Jendela beku: **8 November 2026 15:00 WIB → 14 November 2026 23:59 WIB**.
- Setelah 15 November 2026 03:00 WIB: jalankan `npm run history`, `npm run backtest`, `export_logs.js`, `npm run recompute`, `npm run freeze`, `npm run dashboard`.
- Hasil forward (jumlah tick, coverage candle, order, duplikasi, pelanggaran risiko, ekuitas akhir, selisih live vs backtest) akan diisi di `REFLEKSI.md` bagian 10 dan dashboard tab **Forward Test**.

Keberhasilan forward test diukur dari **kepatuhan proses**: tidak ada order ganda per candle, semua candle diproses atau alasannya dicatat, tidak ada entry saat kill switch/daily loss aktif, tidak ada order di bawah Rp25.000, kas + nilai posisi rekonsiliasi, dan log mentah bisa dihitung ulang.
