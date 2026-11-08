# Strategi dan Metodologi

Dokumen ini menjelaskan **mengapa** strategi dibangun seperti ini, **bagaimana** backtest dijalankan, dan **apa** yang bisa/tidak bisa disimpulkan dari hasilnya. Deliverable hasil angka ada di `HASIL_BACKTEST.md`; refleksi pribadi ada di `REFLEKSI.md`.

---

## 1. Tujuan dan hipotesis

Tujuan proyek bukan mengejar return tertinggi, tetapi membangun **sistem trading yang dapat diaudit**:

1. sinyal masuk/keluar jelas dan deterministik;
2. eksekusi memakai harga yang realistis (ask/bid, bukan close);
3. biaya dihitung konservatif;
4. keputusan bisa direproduksi dari data mentah;
5. ada pemisahan tegas antara **backtest** dan **forward test**.

Hipotesis strategi:

> Pada pasar crypto IDR yang cenderung trending, harga yang baru menembus MA20 ke atas **dan** berada di atas MA150 akan melanjutkan momentum. Keluar saat harga jatuh di bawah MA150 membatasi kerugian besar. Karena hanya sebagian kecil trade yang menjadi tren besar, distribusi return akan **right-skewed**: win rate rendah, tetapi rata-rata untung jauh lebih besar dari rata-rata rugi.

Hipotesis ini **tidak** mengatakan strategi akan mengalahkan buy & hold. Pada bull market kuat, strategi long-only yang sering di luar pasar bisa tertinggal. Yang diuji adalah apakah **risk-adjusted return** dan **drawdown** cukup baik untuk mempertahankan aturan tersebut.

---

## 2. Pilihan desain

### 2.1 Timeframe 4 jam

- Candle 4 jam memberi **6 keputusan per hari**, cukup untuk bereaksi terhadap perubahan tren tanpa terlalu bising seperti 15 menit/1 jam.
- Data 3 tahun tersedia dan cukup rapi di API Indodax.
- Biaya taker lebih terkendali dibanding timeframe pendek: 461 trade dalam 3 tahun ≈ 0,42 trade/hari untuk 8 pair, bukan ribuan trade yang akan habis oleh fee.
- Forward test 6,37 hari tetap menghasilkan 39 slot candle, cukup untuk melihat perilaku sistem (meskipun tidak cukup untuk menyimpulkan profitabilitas).

### 2.2 Delapan pair IDR paling likuid

- Universe kecil supaya setiap pair bisa dipantau setiap tick dan order book-nya cukup dalam untuk notional Rp10 juta.
- Delapan pair memberi diversifikasi kasar antar-koin, tetapi tetap dalam satu faktor pasar (crypto beta). Diversifikasi ini **tidak** menghilangkan risiko sistemik.
- Pair dipilih dari **likuiditas 30 hari pertama backtest**, bukan volume saat ini. Jika memakai volume 2026, pair yang baru populer belakangan bisa masuk dan menimbulkan **survivorship/look-ahead bias**.
- Kandidat wajib punya cakupan data 1D ≥ 80% dan 4h 3 tahun ≥ 90%, serta bukan stablecoin.

### 2.3 Long-only

- Pasar spot IDR Indodax tidak menyediakan short selling tanpa fitur margin/futures yang lebih kompleks dan berisiko.
- Strategi long-only lebih jujur untuk dry-run spot: tidak ada asumsi pinjam aset atau funding rate.
- Konsekuensi: strategi tidak bisa melindungi portofolio saat seluruh pasar turun. Ini terlihat pada drawdown 2025–2026.

### 2.4 MA20 dan MA150

- **MA20** adalah pemicu momentum jangka pendek. Cross-up dari bawah ke atas MA20 menandakan perubahan arah jangka pendek.
- **MA150** adalah filter tren menengah. Entry hanya jika harga sudah di atas MA150, sehingga strategi tidak membeli bounce di dalam downtrend.
- Exit `Close < MA150` memberi ruang bagi tren untuk bernapas; tidak keluar hanya karena noise di sekitar MA20.
- Kombinasi ini menghasilkan **win rate rendah tetapi payoff besar** — ciri khas trend-following.

Parameter **N=20, X=150** diwarisi dari pemilihan in-sample pada tugas sebelumnya (data saham Kompas100, split 70% in-sample / 30% out-of-sample). Pada proyek crypto ini, parameter **tidak dioptimasi ulang**. Alasannya:

- menghindari **overfitting** pada 3 tahun data crypto yang hanya satu rezim pasar;
- menjaga integritas perbandingan: backtest bukan hasil pencarian grid yang tak terbatas;
- forward test menjadi uji out-of-sample yang lebih bermakna.

Trade-off: parameter ini mungkin bukan yang optimal untuk crypto. Itu diterima sebagai keterbatasan, bukan diperbaiki diam-diam setelah melihat hasil.

### 2.5 Alokasi 10% dan maksimum 8 posisi

- 10% per posisi × 8 posisi = maksimum 80% ekuitas. Sisa 20% menjadi buffer untuk fee, slippage, dan mark-to-market.
- Dengan 8 pair, maksimum 8 posisi berarti **satu posisi per pair**. Tidak ada konsentrasi ganda pada satu koin.
- Alokasi 10% membuat ukuran order sekitar Rp10 juta pada modal awal. Ini cukup besar untuk menguji depth, tetapi tidak terlalu besar untuk pair yang likuiditasnya ratusan juta rupiah per hari.
- Position sizing **compounding**: target 10% dari ekuitas saat entry, bukan 10% dari modal awal. Dengan demikian eksposur tumbuh saat ekuitas naik.

### 2.6 Batas likuiditas 5% ADV

Target order dibatasi:

```
target = min(10% × ekuitas, 5% × rata-rata nilai transaksi harian 30 hari, kas)
```

Tujuannya agar order tidak menjadi bagian terlalu besar dari pasar dan agar slippage depth walk tetap realistis. Rata-rata 30 hari dihitung dari 180 bar 4 jam:

```
ADV30 = mean(close × volume per bar) × (86400 / 14400)
```

---

## 3. Definisi sinyal

Untuk setiap pair, pada candle `s` yang **sudah tertutup**:

```
SMA20[s]  = mean(Close[s-19 .. s])
SMA150[s] = mean(Close[s-149 .. s])

entry[s] = Close[s] > SMA20[s]
           AND Close[s-1] <= SMA20[s-1]
           AND Close[s] > SMA150[s]

exit[s]  = Close[s] < SMA150[s]
```

Aturan tambahan:

- `entry` dan `exit` tidak dieksekusi pada candle `s`; eksekusi terjadi pada tick/bar berikutnya.
- Jika posisi sudah ada, `entry` diabaikan (satu posisi per pair).
- Jika `exit` benar dan posisi ada, seluruh posisi ditutup.
- Jika sinyal entry muncul tetapi order book tidak valid, spread > 2%, pair maintenance, atau slippage > 1%, entry **dilewati** dan dicatat alasannya.
- Jika sinyal entry muncul tetapi daily loss limit aktif atau kill switch aktif, entry **diblokir**; exit tetap berjalan.

Pseudocode inti (`lib/strategy.js`) kurang lebih:

```js
for (let i = 0; i < candles.length; i++) {
  const maN = sma(close, N, i);
  const maX = sma(close, X, i);
  const entry = i > 0 &&
    close[i] > maN && close[i - 1] <= maNprev &&
    close[i] > maX;
  const exit = close[i] < maX;
  ...
}
```

Fungsi yang sama dipakai oleh `lib/backtest.js` dan `lib/bot.js`. Tidak ada salinan aturan sinyal di dua tempat.

---

## 4. Model eksekusi

### 4.1 Backtest

Pada bar `t` (satu bar setelah sinyal `s`):

```
buyFill  = ceil( Open[t] × (1 + spread/2 + slippage) / priceStep ) × priceStep
sellFill = floor(Open[t] × (1 - spread/2 - slippage) / priceStep ) × priceStep
```

- Beli di **ask**, jual di **bid**.
- `Open[t]` adalah harga pembukaan bar setelah candle sinyal tertutup. Ini setara dengan tick pertama setelah candle `s` tutup.
- `spread/2` dan `slippage` berasal dari snapshot order book per pair.
- Pembulatan harga ke `priceStep` pair (misalnya BTCIDR Rp1.000, pair lain Rp1) membuat fill tidak bisa mustahil secara tick size.

### 4.2 Live dry-run

- Ambil order book `/api/depth/{pair.id}`.
- `walkBuy(asks, target)` menelusuri level ask sampai notional target terpenuhi; `walkSell(bids, qty)` menelusuri bid.
- Harga fill = rata-rata tertimbang level yang terpakai.
- Jika depth tidak cukup, qty dipotong ke likuiditas yang tersedia; order tidak dipaksakan.
- Fee dihitung dari notional fill.
- Tidak ada order yang dikirim ke bursa.

Perbedaan yang wajar antara live dan backtest:

| Backtest | Live dry-run |
|---|---|
| Fill di open bar berikutnya | Fill di tick pertama setelah candle tutup |
| Satu level sintetis (open ± spread/2 ± slippage) | Depth walk multi-level nyata |
| Spread/slippage tetap sepanjang periode | Spread/slippage berubah tiap tick |
| Tidak ada partial fill karena depth | Qty bisa terpotong jika depth tipis |
| Equity di close bar | Equity di bid tick |

Karena itu, dashboard menyediakan perbandingan **live vs backtest jendela yang sama**, dan selisih eksekusi tidak otomatis dianggap bug.

---

## 5. Model biaya

### 5.1 Fee

```
feeBuy  = notional × 0,0020555
feeSell = proceeds × 0,0041555
```

Tarif ini adalah **all-in fee** untuk IDR Market PRO di halaman resmi Indodax, efektif 1 Oktober 2026. `/api/pairs` mencantumkan taker 0,2%; proyek memakai tarif yang **lebih mahal** dari halaman resmi. Minimum order memakai **Rp25.000** (ketentuan Pro), bukan Rp10.000 dari API.

### 5.2 Spread dan slippage

- Spread = `(ask - bid) / mid`, diukur dari order book.
- Slippage beli = `harga rata-rata depth walk / ask - 1`.
- Slippage jual = `1 - harga rata-rata depth walk / bid`.
- Untuk backtest, dipakai `max(median slippage beli, median slippage jual)` per pair, dengan **floor 0,05%** untuk spread dan slippage.
- Notional pengukuran = 10% × Rp100 juta = Rp10 juta, sama dengan target posisi awal.

Floor 0,05% sengaja dipakai karena order book crypto IDR bisa sangat rapat di layar, tetapi eksekusi nyata untuk notional Rp10 juta tetap terkena biaya. Tanpa floor, backtest akan terlalu optimistis.

### 5.3 Pajak dan biaya lain

Tidak ada pajak, biaya deposit/withdrawal, atau biaya jaringan on-chain dalam model. Untuk dry-run spot IDR, komponen ini kecil relatif terhadap fee, tetapi tetap merupakan keterbatasan.

---

## 6. Kontrol risiko

### 6.1 Daily loss limit 3%

Pada setiap tick/bar:

```
dayStartEquity = kas + nilai posisi pada penutupan hari sebelumnya
pnlToday       = (kas + nilai posisi saat ini) / dayStartEquity - 1
```

Jika `pnlToday <= -3%`, entry baru diblokir sampai pergantian hari **WIB** (UTC+7). Exit tetap berjalan. Tujuannya mencegah strategi terus menambah posisi di hari yang sedang rugi besar.

Catatan: di backtest, mark-to-market harian memakai **close bar saat ini**; di live, memakai **bid tick saat ini**. Keduanya sama-sama konservatif untuk posisi long, tetapi bisa berbeda beberapa basis poin.

### 6.2 Kill switch

- `KILL_SWITCH=1` di environment, atau
- Redis key `indodax:killswitch=1` lewat `/api/kill`.

Efek: entry baru diblokir; exit tetap berjalan. Ini penting agar posisi yang sudah ada tidak terjebak hanya karena operator ingin menghentikan entry.

### 6.3 Idempotensi dan lock

- `state.lastProcessed[symbol]` menyimpan timestamp candle terakhir yang sudah diproses.
- Redis lock `SET NX EX` per `symbol:candleTime` mencegah dua tick paralel memproses candle yang sama.
- Lock global `tick:global` TTL 75 detik mencegah tumpang tindih tick.
- Jika lock gagal, tick mengembalikan `skipped: true`, bukan error.

### 6.4 Validasi data

Sebelum sinyal dipakai:

- candle harus tertutup;
- `high >= max(open, close)`, `low <= min(open, close)`;
- harga > 0, volume > 0;
- gap tidak melebihi toleransi;
- candle tidak lebih tua dari 2 bar;
- order book punya bid/ask;
- spread ≤ 2%.

Pair yang gagal validasi tidak diproses. Ini lebih baik daripada memaksa order dengan data rusak.

### 6.5 Retry dan timeout

- Timeout request 12 detik (histori/depth), retry maksimal 3 kali dengan backoff.
- Deadline tick 45 detik. Jika terlampaui, pair yang belum diproses dicatat dan tick tetap disimpan.
- Tidak ada retry tak terbatas yang bisa menggandakan order; idempotensi per candle tetap menjadi pengaman terakhir.

---

## 7. Desain backtest

### 7.1 Periode dan warm-up

- Backtest: **2023-11-08T00:00:00Z → 2026-11-08T00:00:00Z**.
- Data candle dimulai **2023-10-05**, memberi warm-up > 200 bar untuk MA150.
- `warmup_bars = 200` di config; MA150 butuh 150 bar, sehingga ada buffer ~50 bar.
- Hanya candle di dalam `[startTime, endTime]` yang masuk timeline eksekusi.

### 7.2 Timeline gabungan

Semua pair memakai grid 4 jam yang sama. Timeline adalah union timestamp candle di dalam periode. Untuk setiap timestamp `t`:

1. cek pergantian hari WIB dan daily loss limit;
2. **exit** diproses lebih dulu (agar kas bisa dipakai entry);
3. **entry** diproses, kandidat diurutkan likuiditas;
4. catat sinyal (entry/exit/acted) untuk audit;
5. catat equity mark-to-market.

Exit diproses sebelum entry supaya strategi tidak kehabisan kas hanya karena urutan iterasi.

### 7.3 Ukuran posisi

```
eqEst   = kas + nilai posisi lain pada close sebelumnya
target  = min(10% × eqEst, 5% × ADV30, kas)
qty     = floor(target / (fill × (1 + feeBuy)) / qtyStep) × qtyStep
notional = qty × fill
```

Jika `notional < Rp25.000`, entry dilewati dan dicatat di `skipped`.

### 7.4 Benchmark

Buy & hold **BTCIDR** pada jendela yang sama, modal awal Rp100 juta, tanpa biaya (benchmark murni harga). Benchmark ini bukan portofolio yang bisa diperdagangkan persis, tetapi memberi konteks apakah strategi menambah nilai dibanding memegang aset paling likuid.

### 7.5 Metrik

| Metrik | Definisi |
|---|---|
| Total return | `equity_akhir / equity_awal - 1` |
| CAGR | `(equity_akhir / equity_awal)^(1/tahun) - 1` |
| Max drawdown | minimum `equity/peak - 1` sepanjang kurva |
| Calmar | `CAGR / |MDD|` |
| Win rate | trade dengan `netPnl > 0` / total trade |
| Profit factor gross | total `grossPnl` menang / total `|grossPnl|` kalah |
| Profit factor net | total `netPnl` menang / total `|netPnl|` kalah |
| Cost share | total biaya / total laba kotor trade menang |
| Alpha vs BTC | `return_strategi - return_BTC` (bukan Jensen alpha) |
| Average exposure | rata-rata `invested/equity` sepanjang kurva |

`grossPnl` dihitung dari harga mid eksekusi (open bar), bukan close sinyal. Ini membuat biaya spread/slippage terpisah dari pergerakan harga dan memudahkan audit.

---

## 8. Hasil dan interpretasi

### 8.1 Angka utama

- Return **+43,55%** dalam 3,00 tahun; CAGR **+12,80%**.
- MDD **−42,46%**; Calmar **0,30**.
- 461 trade; win rate **18,22%**; PF gross **1,80**, PF net **1,22**.
- Rata-rata untung **+20,48%**, rata-rata rugi **−3,14%**.
- Total biaya **Rp68,78 juta** = **27,21%** dari laba kotor.
- Rata-rata eksposur hanya **33,15%**.
- Benchmark BTC **+147,63%**; strategi **kalah** sekitar 104 poin persentase.

### 8.2 Apakah hipotesis didukung?

**Sebagian.**

Yang mendukung:

- Distribusi memang right-skewed: 84 trade menang menghasilkan rata-rata +20,48%, sedangkan 377 trade kalah hanya −3,14%.
- PF gross 1,80 menunjukkan sistem menang secara bruto bahkan sebelum biaya.
- Ada periode di mana strategi menghasilkan return besar (2024 +77,35%).

Yang tidak mendukung:

- Setelah biaya, PF net hanya 1,22. Biaya menggerus sebagian besar edge.
- Drawdown −42,46% sangat besar; secara risk-adjusted belum layak.
- 2025 dan 2026 negatif. Strategi tidak kebal rezim.
- Return 2024 sangat terkonsentrasi: November 2024 saja **+65,68%**. Tanpa bulan itu, gambaran hasil jauh lebih biasa. Ini menunjukkan ketergantungan pada sedikit episode tren besar.
- Win rate 18% dengan **32 loss beruntun** membuat implementasi psikologis sulit.

### 8.3 Drawdown

- Puncak ekuitas: **4 Desember 2024**.
- Palung drawdown: **2 November 2026**.
- Drawdown berlangsung hampir **23 bulan**. Ini bukan drawdown singkat; ini ujian kesabaran jangka panjang.
- Penyebab utama: pasar crypto 2025–2026 tidak trending naik sekuat 2024, sementara strategi long-only tetap harus keluar-masuk dan membayar biaya.

### 8.4 Konsentrasi kontribusi

- **DOGEIDR** menyumbang +Rp26,7 juta dari 41 trade.
- **ETHIDR** +Rp12,1 juta dari 50 trade.
- **TRXIDR** −Rp6,0 juta dari 87 trade; **ADAIDR** −Rp2,0 juta dari 57 trade.
- Pair dengan frekuensi tinggi belum tentu menguntungkan; biaya dan whipsaw lebih besar.

### 8.5 Sensitivitas biaya (ilustrasi aritmetika)

Laba kotor (gross profit − gross loss) ≈ **Rp112,33 juta**. Total biaya ≈ **Rp68,78 juta**. Jadi net ≈ Rp43,55 juta.

Jika biaya dua kali lipat (ceteris paribus, tanpa mengubah harga/holding), net menjadi sekitar:

```
112,33 - 2 × 68,78 ≈ -25,23 juta
```

Artinya strategi **sangat sensitif terhadap biaya**. Ini bukan hasil backtest terpisah, hanya ilustrasi aritmetika untuk menunjukkan margin tipis. Model biaya yang lebih mahal atau likuiditas yang lebih buruk bisa membalik tanda return.

---

## 9. Keterbatasan dan ancaman validitas

### 9.1 Keterbatasan data

- Snapshot spread/slippage hanya **24 baris** pada satu jendela 13.54–13.55 WIB, 8 November 2026. Likuiditas 2023–2025 bisa berbeda. Floor 0,05% membantu, tetapi bukan model penuh.
- Data candle dari API publik bisa memiliki gap/outlier. Validasi menolak data buruk, tetapi tidak memperbaiki data.
- Universe dipilih dari pair yang masih ada dan punya data; pair yang delisting atau tidak punya data 3 tahun tidak masuk. Ini sebagian mengurangi survivorship, tetapi tidak menghilangkannya sepenuhnya.

### 9.2 Keterbatasan model

- Backtest mengasumsikan **fill penuh** pada satu level sintetis. Live memakai depth walk; hasil bisa berbeda.
- Tidak ada model antrean order, latency, partial fill, atau kegagalan API.
- Tidak ada pajak, withdrawal, atau biaya on-chain.
- Daily loss di backtest memakai close bar, bukan intrabar. Drawdown intrabar bisa lebih dalam.
- Tidak ada short selling, margin, atau hedging.
- Tidak ada walk-forward parameter optimization atau Monte Carlo. Hasil adalah **satu jalur historis**, bukan distribusi kemungkinan.

### 9.3 Keterbatasan forward test

- Forward test hanya **6,37 hari** (39 slot candle), bukan 10 hari. Ini deviasi yang disepakati dan dicatat.
- 6 hari tidak cukup untuk menyimpulkan profitabilitas. Yang bisa dinilai adalah **kepatuhan proses**: apakah bot memproses candle, mematuhi idempotensi, mencatat order, dan merekonsiliasi ekuitas.
- Forward test bertepatan dengan kondisi pasar tertentu; hasilnya tidak bisa digeneralisasi.

### 9.4 Keterbatasan akademik

- Parameter diwarisi, bukan dioptimasi pada crypto. Ini mengurangi overfitting tetapi juga berarti parameter mungkin tidak ideal.
- Tidak ada uji sensitivitas parameter penuh pada data crypto. Yang ada adalah analisis biaya dan interpretasi konsentrasi return.
- Alpha vs BTC adalah selisih return sederhana, bukan alpha yang disesuaikan risiko.

---

## 10. Prosedur eksperimen

### 10.1 Sebelum freeze

1. Pilih universe dari likuiditas 30 hari pertama.
2. Tarik candle 3 tahun + warm-up.
3. Ukur spread/slippage dari order book.
4. Jalankan backtest 3 tahun.
5. Audit dengan `recompute.js`.
6. Bekukan parameter, universe, biaya, dan jendela forward di `config/frozen.json`.
7. Buat manifest SHA-256 dengan `freeze.js`.
8. Commit dengan pesan `freeze-2026-11-08`.

### 10.2 Forward

1. Deploy ke Vercel + Upstash.
2. Jalankan tick tiap jam lewat GitHub Actions (Vercel Cron sebagai backup).
3. Setiap tick memakai fungsi sinyal yang sama dan mencatat order/equity/error.
4. Setelah 14 November 23:59 WIB, ekspor log mentah.
5. Backtest ulang jendela yang sama (`backtest_forward.json`) dengan biaya yang sama.
6. Bandingkan live vs backtest; bedakan **bug** dari **perbedaan eksekusi yang wajar**.
7. Hitung ulang metrik dari log mentah (`recompute.js`).
8. Bangun dashboard final dan commit.

### 10.3 Kriteria evaluasi

Karena forward test pendek, kriteria utama bukan "untung berapa", tetapi:

- **Tidak ada order ganda** untuk candle yang sama.
- **Semua candle** dalam jendela diproses (atau alasannya dicatat).
- **Tidak ada entry** saat kill switch/daily loss limit aktif.
- **Tidak ada order** di bawah Rp25.000.
- **Kas + nilai posisi** rekonsiliasi dengan ekuitas yang dicatat.
- **Log mentah** lengkap dan bisa dihitung ulang.
- **Tidak ada rahasia** yang bocor ke repo.

---

## 11. Reproduksibilitas

Semua angka di dashboard berasal dari artefak, bukan diketik manual:

```
data/candles/*.csv
  → scripts/backtest.js
  → results/backtest_full.json, backtest_trades.csv, backtest_equity.csv
  → scripts/recompute.js
  → results/recompute.json
  → scripts/build_dashboard.js
  → results/report.json, public/data.js
```

Untuk mereproduksi:

```powershell
npm run history
npm run backtest
npm run recompute
npm run freeze
npm run dashboard
npm run verify
```

Untuk audit independen:

```powershell
npm run recompute
npm run verify
```

`recompute.js` membaca CSV dan log mentah, lalu menghitung ulang return, MDD, win rate, PF, fee, biaya, jumlah trade, rekonsiliasi PnL, fee per order, urutan waktu, daily loss, dan minimum order. Tidak ada angka dashboard yang dipakai sebagai input.

---

## 12. Ringkasan satu paragraf

Strategi Dual SMA 20/150 adalah trend-following long-only yang masuk saat momentum jangka pendek menembus MA20 dan harga berada di atas MA150, lalu keluar saat harga jatuh di bawah MA150. Pada backtest 3 tahun, strategi menghasilkan +43,55% (CAGR 12,80%) dengan drawdown −42,46%, kalah dari buy & hold BTC (+147,63%) tetapi dengan drawdown sedikit lebih kecil. Edge bruto ada (PF 1,80), tetapi biaya menggerus sebagian besar (PF net 1,22, biaya 27,21% dari laba kotor). Hasil sangat bergantung pada sedikit trade besar dan satu bulan kuat (November 2024). Forward test 6,37 hari dirancang bukan untuk membuktikan profitabilitas, tetapi untuk menguji apakah sistem berjalan sesuai aturan: sinyal yang sama, eksekusi ask/bid, biaya konservatif, idempotensi, dan log yang bisa diaudit.
