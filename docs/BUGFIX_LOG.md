# Log Perbaikan Bug (tanpa mengubah aturan)

Sesuai ketentuan UAS: perbaikan bug yang **tidak mengubah aturan, parameter, atau universe**
boleh dilakukan setelah freeze, tetapi wajib dicatat. File ini mencatat setiap perubahan tersebut.

Aturan strategi, parameter (`N=20`, `X=150`), universe 8 pair, fee, dan batas risiko **tidak berubah**.
Hash gabungan aturan (`freeze_hash.aggregate`) tetap sama sebelum dan sesudah perbaikan.

---

## BF-001 — `server_time` Indodax dalam milidetik

- **Tanggal:** 2026-11-09 (WIB)
- **File:** `lib/indodax.js` (`getServerTime`)
- **Dampak:** bot live tidak bisa berjalan sama sekali (bukan perubahan hasil backtest).
- **Gejala:** `/api/server_time` mengembalikan `server_time` dalam **milidetik**
  (contoh 9 Nov 2026: `1794190588758`), sedangkan seluruh perhitungan bot memakai unix **detik**.
  Tanpa normalisasi:
  - `new Date(serverTime * 1000)` menjadi tahun ~58.000;
  - `from`/`to` pada `history_v2` salah 1000x;
  - validasi "candle tertutup" dan jendela forward tidak pernah cocok.
- **Bukti:** respons mentah `{"timezone":"UTC","server_time":1794190588758}` pada
  2026-11-09T02:16:28Z, dibandingkan `Date.now()` = `1794190587902` ms.
- **Perbaikan:** normalisasi ke detik bila nilai > `1e12`.
  ```js
  let t = Number(j && j.server_time !== undefined ? j.server_time : j);
  if (Number.isFinite(t) && t > 1e12) t = Math.floor(t / 1000);
  return t;
  ```
- **Verifikasi:**
  - `node scripts/tick_local.js` → `Waktu server 2026-11-09T02:16:54.000Z`, 8 pair diproses,
    ekuitas Rp100.000.000, 0 error.
  - Tick kedua (setelah lock 75 detik) → `Diproses: -`, 0 order (idempotensi per candle bekerja).
- **Tidak mengubah aturan:** hash agregat aturan tetap
  `05739d638487a99b4176ecc21cb447e4e706ebe8196771a414224c25f93483d7`.
  Hanya hash file `lib/indodax.js` di manifest yang berubah.
- **Commit:** `62c27bf`.

---

## BF-002 — Coverage forward dihitung dari `lastProcessed`, bukan candle nyata

- **Tanggal:** 2026-11-09 (WIB)
- **File:** `lib/report.js` (`progressOf`, `liveReport`)
- **Dampak:** hanya tampilan coverage dashboard; tidak mengubah sinyal, order, atau hasil backtest.
- **Gejala:** `progressOf` menghitung candle terjadwal dari `state.lastProcessed`. Jika deployment molor, bot hanya memproses candle terbaru dan melewati candle awal jendela; `lastProcessed` tetap menunjuk candle terbaru sehingga coverage bisa terlihat 100% padahal banyak candle tidak pernah diproses.
- **Perbaikan:** coverage dihitung dari candle unik yang benar-benar tercatat di `calls.jsonl` (`serverTime` → candle terakhir yang tertutup, digabung dengan `signals[].candleTime`), di-dedupe per pair. Fallback ke `lastProcessed` hanya jika log calls belum ada.
- **Verifikasi:** simulasi satu tick pada 2026-11-09T00:07Z menghasilkan coverage 20% (1 dari 5 candle), bukan 100%; simulasi semua candle menghasilkan 100%.
- **Tidak mengubah aturan:** `lib/report.js` tidak termasuk file yang di-hash `freezeHash`; `npm run verify` tetap `FREEZE UTUH`.
- **Commit:** `62c27bf`.

---

## BF-003 — Rewrite Vercel mengarah ke `/public/...`

- **Tanggal:** 2026-11-09 (WIB)
- **File:** `vercel.json`
- **Dampak:** deployment Vercel; bukan aturan trading.
- **Gejala:** rewrite `/` → `/public/index.html` dan aset lain mengarah ke path yang tidak ada di output Vercel. Folder `public/` sudah disajikan di root, sehingga file hasil deployment adalah `/index.html`, bukan `/public/index.html`.
- **Perbaikan:** hapus seluruh blok `rewrites`; Vercel menyajikan `public/index.html`, `style.css`, `app.js`, `data.js`, dan `data/*` langsung dari root.
- **Verifikasi:** handler `/api/dashboard?section=static` diuji lokal (HTTP 200, 461 trade); struktur static mengikuti perilaku Vercel `public/`.
- **Tidak mengubah aturan:** `vercel.json` tidak termasuk file yang di-hash; `npm run verify` tetap `FREEZE UTUH`.
- **Commit:** `d80cfd7`.
