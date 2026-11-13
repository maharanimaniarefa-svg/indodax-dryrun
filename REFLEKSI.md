# Refleksi

**Refa Maharani Imaniar · NIM 25110200011 · UAS Algoritma Trading**

Dokumen ini adalah refleksi proses, bukan laporan hasil. Angka hasil ada di `HASIL_BACKTEST.md`; metodologi ada di `STRATEGI.md`.

---

## 1. Ringkasan proses

Saya membangun bot **dry-run** Indodax dengan empat bagian yang saling bergantung:

1. **Pemilihan universe** dari likuiditas awal periode, bukan volume saat ini.
2. **Backtest 3 tahun** dengan fungsi sinyal yang sama seperti bot.
3. **Forward test** lewat Vercel + Upstash + GitHub Actions.
4. **Dashboard dan audit** yang membaca artefak mentah, bukan angka yang diketik manual.

Yang paling saya pelajari bukan cara menghitung SMA, tetapi cara membuat **sistem yang bisa dipercaya**: data divalidasi, eksekusi memakai ask/bid, biaya dihitung konservatif, order idempoten, dan hasil bisa dihitung ulang dari log mentah.

Pada saat dokumen ini diperbarui (13 November 2026), backtest, audit, dan deployment sudah selesai. **Forward test sedang berjalan**: dimulai 8 November 2026 15.00 WIB dan berakhir 14 November 2026 23.59 WIB. Bagian 10 berisi prosedur pengisian angka forward setelah jendela berakhir. Deviasi jadwal terhadap instruksi UAS dijelaskan terbuka di Bagian 12.

---

## 2. Apa yang berjalan baik

### 2.1 Satu fungsi sinyal untuk dua mesin

Keputusan terbaik dalam proyek ini adalah memakai `lib/strategy.js` untuk **bot dan backtest**. Awalnya saya tergoda menulis logika sinyal terpisah di `bot.js` karena lebih cepat. Akibatnya akan ada dua definisi entry/exit yang bisa berbeda diam-diam. Dengan satu fungsi, setiap perubahan aturan langsung memengaruhi keduanya, dan audit sinyal di `backtest_signals.csv` benar-benar mencerminkan yang dijalankan bot.

### 2.2 Eksekusi tidak memakai close

Backtest yang membeli di `close` sinyal akan terlihat jauh lebih bagus, tetapi tidak realistis. Saya memaksa model eksekusi:

- beli di **ask**,
- jual di **bid**,
- depth walk untuk notional target,
- pembulatan ke `priceStep`,
- fee taker all-in.

Hasilnya lebih jelek, tetapi lebih jujur. Ini penting karena salah satu tujuan tugas adalah membangun kebiasaan backtest yang tidak menipu diri sendiri.

### 2.3 Biaya yang lebih mahal dari API

Saya awalnya memakai taker 0,2% dari `/api/pairs`. Setelah memeriksa halaman resmi Indodax, tarif all-in Pro adalah **0,20555% beli** dan **0,41555% jual**, dengan minimum order **Rp25.000**. Saya memilih angka yang **lebih mahal** dan minimum yang **lebih ketat**. Ini mengurangi return backtest, tetapi menghindari optimisme yang tidak perlu.

### 2.4 Universe dipilih sebelum backtest

Menggunakan volume 2026 untuk memilih pair 2023 akan menimbulkan survivorship bias. Saya memilih pair dari **median nilai transaksi 30 hari pertama periode backtest**. Pair yang baru populer belakangan tidak otomatis masuk. Ini keputusan yang benar secara metodologi, meskipun membatasi universe.

### 2.5 Audit independen

`recompute.js` membaca CSV dan log mentah, lalu menghitung ulang return, MDD, win rate, PF, fee, biaya, jumlah trade, rekonsiliasi PnL, fee per order, urutan waktu, daily loss, dan minimum order. Hasilnya **19/19 PASS**. Saya tidak ingin dashboard menjadi satu-satunya sumber kebenaran.

---

## 3. Kesulitan teknis dan cara mengatasinya

### 3.1 API Indodax tidak selalu konsisten bentuknya

Beberapa endpoint mengembalikan **array langsung**, beberapa mengembalikan `{ value: [...] }`. Awalnya `fetchHistoryBackward` dan `/api/pairs` gagal karena asumsi bentuk respons yang kaku. Saya memperbaiki normalisasi respons di `lib/indodax.js` dan menambah penanganan bare array.

### 3.2 Depth memakai id pair, bukan ticker

Endpoint `/api/depth/{id}` menerima id seperti **`btcidr`**, bukan ticker seperti **`btc_idr`**. Saya sempat memakai `ticker_id` dan mendapat `invalid_pair`. Perbaikannya: `getDepth` menormalkan id dengan menghapus underscore, dan bot memakai `pair.id` dari `config/universe.json`, bukan `pair.ticker`.

Kesalahan ini terlihat sepele, tetapi membuat seluruh order book gagal. Pelajarannya: jangan mengasumsikan nama field API konsisten hanya karena terlihat mirip.

### 3.3 Span histori yang salah

`fetchHistoryBackward` awalnya meminta rentang yang terlalu pendek, sehingga data 3 tahun tidak lengkap. Saya memperbaiki perhitungan span dan menambahkan merge candle agar data lama tidak hilang saat fetch ulang. Setelah itu setiap pair punya **6.778 bar** dengan cakupan 100%.

### 3.4 Timezone WIB

Daily loss limit harus mengikuti hari **WIB (UTC+7)**, bukan UTC. Saya menambahkan `wibDayKey` dan `wibNextDayStart`, lalu memakai fungsi yang sama di bot dan backtest. Tanpa ini, batas harian bisa reset pada jam yang salah dan hasil backtest tidak cocok dengan live.

### 3.5 Jendela forward dan eksekusi pertama

Sinyal dihitung dari candle yang sudah tertutup. Jika jendela dimulai pukul 08:00 UTC, tick pertama memakai candle 04:00 UTC yang baru tutup pukul 08:00 UTC. Saya menambahkan guard:

- sebelum jendela → `waiting`,
- sesudah jendela → `frozen`,
- di dalam jendela → proses normal.

Backtest jendela forward juga dimulai pada 08:00 UTC agar bar pertama mengeksekusi sinyal candle 04:00 UTC, sama seperti live.

### 3.6 Lock dan idempotensi

Saya menambahkan lock global 75 detik dan lock per `symbol:candleTime` 300 detik. Saat uji lokal, tick kedua dalam 75 detik mengembalikan `skipped` karena lock global. Awalnya saya mengira itu bug; ternyata perilaku yang diinginkan. Untuk smoke test, lock dihapus di antara tick simulasi agar entry/exit bisa diuji.

### 3.7 Dashboard offline vs online

Dashboard harus bisa dibuka **tanpa server** untuk lampiran tugas, tetapi juga menampilkan data live di Vercel. Solusinya:

- `public/data.js` berisi laporan tertanam (`window.__REPORT__`) untuk mode offline;
- saat online, dashboard mencoba `/api/dashboard` dan memakai data live;
- jika fetch gagal, fallback ke laporan tertanam.

Saat diuji lokal, ada error 404 `/api/dashboard` di console karena server statis tidak punya endpoint itu. Ini bukan bug dashboard; fallback tetap berjalan. Di Vercel endpoint tersedia.

---

## 4. Keputusan sulit dan trade-off

### 4.1 Parameter tidak dioptimasi ulang

Saya tergoda mencari N dan X yang paling bagus di data crypto 2023–2026. Itu akan menaikkan return backtest, tetapi membuat hasil tidak jujur: parameter dipilih setelah melihat seluruh periode, lalu dilaporkan sebagai performa out-of-sample.

Saya mempertahankan **N=20, X=150** dari pemilihan in-sample tugas sebelumnya. Konsekuensinya, hasil crypto tidak optimal. Tetapi forward test menjadi uji yang lebih bermakna, dan saya tidak perlu berbohong tentang proses pemilihan parameter.

### 4.2 Long-only

Short selling akan memberi lebih banyak peluang di pasar turun, tetapi tidak realistis untuk spot IDR tanpa margin. Saya memilih long-only dan menerima bahwa strategi akan menderita di pasar bearish. Ini terlihat pada 2025–2026.

### 4.3 Delapan pair

Lima pair akan lebih mudah dipantau, sepuluh pair lebih terdiversifikasi. Saya memilih delapan karena:

- cukup untuk diversifikasi kasar,
- order book tiap pair masih bisa dipindai dalam deadline 45 detik,
- notional Rp10 juta per order tidak terlalu besar untuk pair kedelapan.

### 4.4 Spread snapshot hanya satu titik waktu

Idealnya saya mengambil snapshot order book di banyak jam dan banyak hari. Waktu terbatas sebelum freeze. Saya mengambil **24 snapshot** (3 ronde × 8 pair) pada 8 November 2026, lalu memakai floor 0,05% untuk spread dan slippage. Ini bukan model sempurna, tetapi lebih baik daripada mengarang angka. Saya **tidak** menambah snapshot setelah backtest karena itu akan mengubah input setelah freeze dan melanggar integritas.

### 4.5 Forward test 6,37 hari, bukan 10 hari

Assignment meminta 10 hari. Freeze dilakukan 8 November dan forward test dihentikan 14 November, sehingga jendelanya 6,37 hari (39 slot candle 4 jam). Ini deviasi yang disepakati, bukan kelalaian. Saya mencatatnya di README, STRATEGI, dan dokumen ini.

Yang bisa dinilai dari 6 hari adalah **kepatuhan proses**, bukan profitabilitas. Saya tidak akan mengklaim 6 hari membuktikan strategi menguntungkan.

---

## 5. Kesalahan dan iterasi

Beberapa kesalahan yang saya temukan dan perbaiki:

1. **Depth id** memakai ticker, bukan pair id → order book gagal.
2. **Span histori** terlalu pendek → data 3 tahun tidak lengkap.
3. **Bare array** dari API tidak ditangani → parsing gagal.
4. **Daily loss mark-to-market** awalnya memakai close sebelumnya, bukan close saat ini → batas harian bisa terlambat aktif.
5. **Fee** awalnya 0,2% dari API → diganti tarif resmi yang lebih mahal.
6. **Minimum order** awalnya Rp10.000 → diganti Rp25.000.
7. **Lock global** tidak sengaja membuat tick kedua `skipped` → dipahami sebagai perilaku yang benar, lalu smoke test disesuaikan.
8. **Dashboard progress** menghitung candle secara eksklusif → diperbaiki menjadi inklusif agar coverage mencapai 100% saat semua candle diproses.

Tidak semua kesalahan ditemukan sebelum backtest. Beberapa baru muncul saat audit dan smoke test. Pelajarannya: buat test yang mencoba **membantah** hasil, bukan test yang hanya mengonfirmasi.

---

## 6. Integritas dan etika

Beberapa prinsip yang saya pegang:

- **Tidak ada API key Indodax.** Bot hanya memakai endpoint publik. Tidak ada order nyata, tidak ada dana.
- **Tidak ada look-ahead.** Sinyal hanya dari candle tertutup; eksekusi di tick/bar berikutnya.
- **Biaya konservatif.** Tarif resmi yang lebih mahal, minimum order yang lebih ketat, floor spread/slippage.
- **Universe point-in-time.** Likuiditas awal periode, bukan volume sekarang.
- **Hasil jelek dilaporkan.** Strategi kalah dari BTC; drawdown besar; win rate rendah; 32 loss beruntun. Semua ada di README dan HASIL_BACKTEST.
- **Tidak ada parameter yang diubah setelah melihat hasil.** Parameter dibekukan sebelum forward.
- **Tidak ada rahasia di repo.** `.env` di-`.gitignore`; `.env.example` hanya berisi placeholder.
- **Deviasi dicatat.** Forward 6,37 hari, bukan 10 hari.
- **Keterbatasan diakui.** Spread snapshot terbatas, backtest satu jalur, tidak ada pajak, tidak ada Monte Carlo.

Saya tidak ingin nilai bagus dari backtest yang cantik tetapi tidak bisa dipertanggungjawabkan. Lebih baik hasil biasa tetapi setiap angka bisa ditelusuri.

---

## 7. Pembelajaran tentang strategi

### 7.1 Trend-following itu tidak nyaman

Win rate 18,22% berarti lebih dari 4 dari 5 trade rugi. Secara psikologis, ini sulit. Yang membuat strategi bertahan adalah **ukuran kerugian kecil** (−3,14% rata-rata) dan **ukuran kemenangan besar** (+20,48% rata-rata). Tetapi 32 loss beruntun bisa membuat siapa pun ingin mematikan sistem.

Backtest tidak bisa mengajarkan disiplin. Yang bisa dilakukan adalah membuat aturan yang tidak ambigu dan dashboard yang menunjukkan apakah aturan dipatuhi.

### 7.2 Biaya adalah musuh utama

Total biaya Rp68,78 juta = 27,21% dari laba kotor. PF gross 1,80 turun menjadi PF net 1,22. Jika biaya dua kali lipat, strategi berubah menjadi rugi sekitar Rp25 juta (ilustrasi aritmetika). Ini membuat saya lebih menghargai strategi yang **frekuensinya rendah** dan **holding period panjang**. Setiap trade tambahan harus membayar fee beli + jual + spread + slippage.

### 7.3 Return terkonsentrasi

November 2024 menyumbang +65,68% dalam satu bulan. Tanpa bulan itu, hasil 3 tahun jauh lebih biasa. Ini mengingatkan bahwa rata-rata return bisa menyesatkan; distribusi dan ketergantungan pada beberapa episode besar lebih penting.

### 7.4 Eksposur rendah bukan selalu bagus

Rata-rata eksposur hanya 33,15%. Strategi sering di luar pasar karena filter MA150. Ini mengurangi drawdown, tetapi juga membuat strategi tertinggal saat BTC naik kuat. Tidak ada makan siang gratis: filter tren mengorbankan sebagian upside untuk menghindari downtrend.

### 7.5 Drawdown panjang itu nyata

MDD −42,46% dari Desember 2024 sampai November 2026, hampir 23 bulan. Di atas kertas, drawdown terlihat seperti angka. Di dunia nyata, 23 bulan tanpa high baru adalah ujian besar. Position sizing 10% per posisi tidak cukup untuk membuat drawdown ini nyaman.

---

## 8. Apa yang akan saya lakukan berbeda

Jika ada waktu dan sumber daya:

1. **Snapshot spread/slippage lebih banyak** di berbagai jam dan hari, bukan hanya satu jendela 2 menit.
2. **Walk-forward analysis** dengan beberapa jendela in-sample/out-of-sample, bukan satu backtest 3 tahun.
3. **Uji sensitivitas parameter** (N dan X di sekitar 20/150) untuk melihat apakah hasil stabil atau hanya kebetulan.
4. **Monte Carlo / bootstrap** trade untuk melihat distribusi drawdown, bukan hanya satu jalur.
5. **Regime filter** (misalnya BTC di atas MA200 atau volatilitas realized) untuk mengurangi entry di pasar sideways.
6. **Volatility targeting** agar ukuran posisi menyesuaikan risiko, bukan tetap 10%.
7. **Analisis trade per pair** yang lebih dalam: mengapa TRXIDR dan ADAIDR merugi, apakah karena whipsaw atau biaya.
8. **Forward test lebih panjang** (10 hari atau lebih) agar hasilnya lebih bermakna.
9. **Model antrean/latency** dan pengukuran slippage live vs backtest secara statistik.
10. **Dashboard yang menampilkan live vs backtest per trade**, bukan hanya ringkasan.

---

## 9. Refleksi pribadi

Proyek ini mengajarkan saya bahwa membangun bot bukan terutama soal prediksi harga. Yang lebih sulit adalah:

- memastikan data yang masuk benar;
- memastikan eksekusi yang disimulasikan masuk akal;
- memastikan biaya tidak disembunyikan;
- memastikan hasil bisa dihitung ulang;
- memastikan diri sendiri tidak mengubah aturan setelah melihat hasil.

Saya juga belajar bahwa **hasil yang jelek tidak berarti proyek yang gagal**. Backtest yang jujur bisa menghasilkan kesimpulan "strategi ini belum layak". Itu tetap temuan yang valid, dan lebih berguna daripada backtest cantik yang penuh asumsi tersembunyi.

Saya cukup puas dengan:

- satu fungsi sinyal untuk bot dan backtest;
- model biaya yang lebih mahal dari API;
- audit 19/19 PASS;
- dashboard offline yang bisa dibuka tanpa server;
- freeze manifest yang mendeteksi perubahan file.

Saya tidak puas dengan:

- forward test yang pendek;
- snapshot spread yang terbatas;
- drawdown dan underperformance vs BTC;
- belum adanya uji sensitivitas parameter di data crypto.

Kedua daftar itu sama pentingnya. Yang pertama menunjukkan apa yang sudah dikerjakan; yang kedua menunjukkan apa yang masih harus dikerjakan.

---

## 10. Prosedur finalisasi setelah forward test (14 November 2026)

1. Candle 4 jam terakhir yang masuk ke laporan adalah candle 12.00–16.00 UTC 14 November (tutup 23.00 WIB). Finalisasi dijalankan 14 November 23.10 WIB. Candle 16.00–20.00 UTC dilepas karena tenggat pengumpulan 23.59 WIB.
2. Panggil `/api/tick` manual (tidak menunggu cron), lalu jalankan berurutan: `node scripts/export_logs.js` → `npm run recompute` → `npm run history` → `npm run backtest` → `npm run freeze` → `npm run dashboard` → `npm run verify`.
3. Sebagian candle awal jendela tidak pernah diproses karena penjadwal otomatis baru aktif penuh 10 November. Bot tidak melakukan order retroaktif; dashboard menampilkan coverage berdasarkan candle yang benar-benar ada di `calls.jsonl`. Ini dilaporkan apa adanya, bukan ditutupi dengan angka `lastProcessed`.
4. Isi tabel berikut dari `results/recompute.json` dan `logs/export/`. Tidak ada angka yang diketik manual:

| Item | Hasil |
|---|---|
| Jumlah tick | _isi_ |
| Candle coverage | _isi_ |
| Order BUY / SELL | _isi_ |
| Duplikasi order per candle | _isi_ (harus 0) |
| Pelanggaran daily loss | _isi_ (harus 0) |
| Order < Rp25.000 | _isi_ (harus 0) |
| Ekuitas akhir forward | _isi_ |
| Return forward | _isi_ |
| Backtest jendela yang sama | _isi_ |
| Selisih live vs backtest | _isi_ |
| Error yang tercatat | _isi_ |

5. Bandingkan live vs backtest. Bedakan:
   - **bug** (order ganda, sinyal salah, kas tidak rekonsiliasi),
   - **perbedaan eksekusi wajar** (depth walk, timing, spread berubah).
6. Tulis paragraf refleksi tambahan: apa yang berjalan sesuai rencana, apa yang tidak, dan apa yang akan diperbaiki.
7. Commit hasil forward dan dashboard final.

Saya tidak akan mengklaim forward test berhasil hanya karena return positif. Keberhasilan diukur dari **kepatuhan proses**: tidak ada order ganda, semua candle diproses atau alasannya dicatat, tidak ada pelanggaran risiko, dan log bisa dihitung ulang.

---

## 11. Penutup

Proyek ini adalah latihan membangun sistem trading yang **dapat diaudit**, bukan mencari strategi ajaib. Hasil backtest 3 tahun biasa saja: +43,55%, drawdown −42,46%, kalah dari BTC. Tetapi setiap angka punya jejak: data candle, fungsi sinyal, model biaya, trade log, kurva ekuitas, audit, dan freeze manifest.

Jika ada satu hal yang saya bawa dari proyek ini, itu adalah kebiasaan bertanya:

> "Apakah hasil ini bisa saya pertahankan jika seseorang memeriksa data mentahnya?"

Itulah standar yang saya coba penuhi.

---

## 12. Kepatuhan terhadap jadwal instruksi UAS

Instruksi UAS menetapkan freeze 4 November 2026 12.00 WIB, forward test 10 hari (4–14 November), dan pengumpulan 14 November 23.59 WIB. Pelaksanaan proyek ini bergeser. Saya laporkan perbedaannya terbuka, bukan ditutupi.

| Item | Instruksi | Aktual | Selisih |
|---|---|---|---|
| Freeze aturan & parameter | 4 Nov 2026 12.00 WIB | 8 Nov 2026 13.41 WIB | +4 hari 1 jam |
| Awal forward test | 4 Nov 2026 12.00 WIB | 8 Nov 2026 15.00 WIB | +4 hari 3 jam |
| Akhir forward test | 14 Nov 2026 12.00 WIB | 14 Nov 2026 23.59 WIB | +11 jam 59 menit |
| Durasi forward | 10 hari | 6,37 hari | −3,63 hari |
| Cakupan candle 4 jam | 100% | di bawah 100% (angka final di Bagian 10) | candle awal tidak teramati |
| Bukti freeze | riwayat commit publik **atau** ZIP + `.git` | **keduanya** tersedia | sesuai |
| Pengumpulan | 14 Nov 2026 23.59 WIB | 14 Nov 2026 sebelum 23.59 WIB | sesuai |

**Sebab deviasi.** Deployment Vercel + Upstash baru selesai 8 November 2026 13.41 WIB, bukan 4 November. Repositori dibuat lokal sejak 8 November dan baru di-push ke GitHub pada 9 November; timestamp commit tidak diubah. Penjadwal otomatis (GitHub Actions) baru menerima secret pada 10 November 07.18 UTC, sehingga candle 8–9 November tidak pernah teramati.

**Mengapa tidak diperbaiki dengan mengubah tanggal.** Mengubah `frozen_at_wib`, tanggal commit, atau manifest akan membuat bukti freeze tidak sah dan termasuk fabrikasi data. Aturan, parameter, dan universe tetap persis seperti yang di-commit pada 8 November (`freeze_hash` 05739d63…483d7).

**Konsekuensi yang diterima.** Perbandingan backtest–forward memakai jendela yang benar-benar dijalankan (8 Nov 15.00 WIB → 14 Nov 23.59 WIB), bukan jendela 4–14 November. `results/backtest_forward.json` dihitung pada jendela yang sama, sehingga perbandingannya tetap setara. Cakupan candle di bawah 100% dilaporkan apa adanya di dashboard, bukan diklaim penuh.
