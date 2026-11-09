<#
  Menghapus Windows Task Scheduler bot dry-run Indodax.
  State & log di folder logs\ TIDAK dihapus.
#>
$ErrorActionPreference = 'Stop'
$taskName = 'IndodaxDryRunTick'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "TASK DIHAPUS: $taskName"
} else {
  Write-Host "Task $taskName tidak ditemukan."
}
Write-Host "Log tetap tersimpan di: $(Join-Path (Split-Path -Parent $PSScriptRoot) 'logs')"
