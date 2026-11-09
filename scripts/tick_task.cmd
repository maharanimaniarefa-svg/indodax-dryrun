@echo off
rem ---------------------------------------------------------------
rem Dipanggil Windows Task Scheduler untuk bot dry-run Indodax.
rem Aturan/parameter tidak diubah di sini: semua dibaca dari
rem config/frozen.json (timeframe 4 jam, N=20, X=150).
rem STORE=file -> state & log mentah ditulis ke folder logs\.
rem ---------------------------------------------------------------
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs
set STORE=file
set KILL_SWITCH=0
node scripts\tick_local.js >> logs\scheduler.log 2>&1
endlocal
