<#
  Mendaftarkan Windows Task Scheduler untuk bot dry-run Indodax.

  - Timeframe bot tetap 4 jam (dibaca dari config/frozen.json; tidak diubah).
  - Task memanggil scripts\tick_task.cmd setiap 15 menit.
  - Berhenti otomatis pada 14 November 2026 23:59 WIB (akhir jendela forward).
  - Bot tetap idempoten: satu candle hanya diproses sekali.

  Jalankan dari PowerShell biasa (tidak perlu Administrator):
      powershell -ExecutionPolicy Bypass -File scripts\register_task.ps1
#>
$ErrorActionPreference = 'Stop'

$taskName = 'IndodaxDryRunTick'
$proj = Split-Path -Parent $PSScriptRoot
$start = (Get-Date).AddMinutes(1)
$end = ([datetimeoffset]'2026-11-14T23:59:00+07:00').LocalDateTime

if ($start -ge $end) {
  throw "Jendela forward sudah lewat ($end). Task tidak didaftarkan."
}

$action = New-ScheduledTaskAction `
  -Execute $env:ComSpec `
  -Argument '/c scripts\tick_task.cmd' `
  -WorkingDirectory $proj

$trigger = New-ScheduledTaskTrigger `
  -Once -At $start `
  -RepetitionInterval (New-TimeSpan -Minutes 15) `
  -RepetitionDuration ($end - $start)

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

$desc = 'UAS Algoritma Trading - bot dry-run Indodax 4h (SMA20/150), log ke logs\. Berhenti 2026-11-14 23:59 WIB.'

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Description $desc -Force | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName

Write-Host "TASK TERDAFTAR: $taskName"
Write-Host ("State        : {0}" -f $task.State)
Write-Host ("Mulai        : {0:yyyy-MM-dd HH:mm:ss zzz}" -f $start)
Write-Host ("Berhenti     : {0:yyyy-MM-dd HH:mm:ss zzz}" -f $end)
Write-Host ("Interval     : 15 menit")
Write-Host ("Next run     : {0}" -f $info.NextRunTime)
Write-Host ("Aksi         : $env:ComSpec /c scripts\tick_task.cmd (cwd $proj)")
Write-Host ""
Write-Host "Cek status : Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo"
Write-Host "Hentikan   : powershell -ExecutionPolicy Bypass -File scripts\unregister_task.ps1"
