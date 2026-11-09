<#
  Deploy bot dry-run Indodax ke Vercel (production) + set environment variables.

  Pemakaian:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy_vercel.ps1 `
      -CronSecret "<secret>" `
      -UpstashUrl "https://xxxxx.upstash.io" `
      -UpstashToken "<token>"

  Tanpa parameter env (hanya deploy kode):
    ... -File scripts\deploy_vercel.ps1 -SkipEnv

  Prasyarat: akun Vercel. Script akan menjalankan `vercel login` bila belum login.
  Tidak ada secret yang ditulis ke repo; nilai hanya dikirim ke Vercel.
#>
param(
  [string]$CronSecret,
  [string]$UpstashUrl,
  [string]$UpstashToken,
  [string]$ProjectName = 'indodax-dryrun',
  [switch]$SkipEnv
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Run-Vercel {
  param([string[]]$VercelArgs)
  & npx --yes vercel@latest @VercelArgs
}

Write-Host '== 1. Cek login Vercel ==' -ForegroundColor Cyan
$who = (& npx --yes vercel@latest whoami 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $who -or $who -match 'Error|not logged in') {
  Write-Host 'Belum login. Membuka proses login Vercel...' -ForegroundColor Yellow
  & npx --yes vercel@latest login
  if ($LASTEXITCODE -ne 0) { throw 'Login Vercel gagal/dibatalkan.' }
  $who = (& npx --yes vercel@latest whoami 2>&1 | Out-String).Trim()
}
Write-Host "Login sebagai: $who"

Write-Host '== 2. Link project ==' -ForegroundColor Cyan
& npx --yes vercel@latest link --yes --project $ProjectName
if ($LASTEXITCODE -ne 0) { throw 'vercel link gagal. Pastikan folder ini adalah root project.' }

function Set-VercelEnv {
  param([string]$Name, [string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    Write-Host "  lewati $Name (kosong)" -ForegroundColor DarkGray
    return
  }
  Write-Host "  set $Name" -ForegroundColor DarkGray
  # hapus dulu agar --force tidak bergantung versi CLI
  & npx --yes vercel@latest env rm $Name production --yes 2>$null | Out-Null
  $Value | & npx --yes vercel@latest env add $Name production --force | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Gagal set env $Name" }
}

if (-not $SkipEnv) {
  Write-Host '== 3. Set environment variables (production) ==' -ForegroundColor Cyan
  if (-not $CronSecret) {
    $CronSecret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
    Write-Host "  CRON_SECRET dibuat otomatis: $CronSecret" -ForegroundColor Yellow
    Write-Host '  SIMPAN nilai ini; dipakai juga untuk GitHub Secrets BOT_URL/CRON_SECRET.' -ForegroundColor Yellow
  }
  Set-VercelEnv 'CRON_SECRET' $CronSecret
  Set-VercelEnv 'UPSTASH_REDIS_REST_URL' $UpstashUrl
  Set-VercelEnv 'UPSTASH_REDIS_REST_TOKEN' $UpstashToken
  Set-VercelEnv 'STORE' 'upstash'
  Set-VercelEnv 'KILL_SWITCH' '0'
}

Write-Host '== 4. Deploy production ==' -ForegroundColor Cyan
$out = (& npx --yes vercel@latest --prod --yes 2>&1 | Out-String)
Write-Host $out
if ($LASTEXITCODE -ne 0) { throw 'Deploy gagal.' }

$url = ([regex]::Matches($out, 'https://[a-zA-Z0-9\.\-]+\.vercel\.app') |
  ForEach-Object { $_.Value } | Select-Object -Last 1)

if (-not $url) { throw 'URL deployment tidak ditemukan di output Vercel.' }
Write-Host ""
Write-Host "DEPLOY SELESAI: $url" -ForegroundColor Green
Write-Host "Dashboard    : $url/"
Write-Host "Health       : $url/api/health"
Write-Host "Tick (auth)  : $url/api/tick"
Write-Host ""
Write-Host 'Langkah berikutnya:' -ForegroundColor Cyan
Write-Host "  1. Isi GitHub Secrets: BOT_URL=$url  dan CRON_SECRET=<secret yang sama>."
Write-Host '  2. Uji tick:'
Write-Host "     curl.exe -H `"Authorization: Bearer `$env:CRON_SECRET`" $url/api/tick"
Write-Host '  3. Setelah tick Vercel terbukti, hentikan task lokal: npm run task:unregister'
