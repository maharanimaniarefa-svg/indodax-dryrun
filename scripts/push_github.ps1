<#
  Push repo ke GitHub (opsional, jika gh CLI tersedia) atau pasang remote + push.

  Pemakaian:
    # jika GitHub CLI sudah login
    powershell -ExecutionPolicy Bypass -File scripts\push_github.ps1 -RepoName indodax-dryrun -Public

    # atau dengan URL repo yang sudah dibuat
    powershell -ExecutionPolicy Bypass -File scripts\push_github.ps1 `
      -RepoUrl https://github.com/USERNAME/indodax-dryrun.git
#>
param(
  [string]$RepoName = 'indodax-dryrun',
  [string]$RepoUrl,
  [switch]$Public
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path .git)) { throw 'Folder ini bukan repo git.' }

$hasGh = Get-Command gh -ErrorAction SilentlyContinue
if ($hasGh) {
  $auth = (& gh auth status 2>&1 | Out-String)
  if ($LASTEXITCODE -eq 0) {
    if (-not (git remote get-url origin 2>$null)) {
      $vis = if ($Public) { '--public' } else { '--private' }
      gh repo create $RepoName $vis --source . --remote origin --push
      Write-Host "Repo GitHub dibuat dan di-push: $RepoName" -ForegroundColor Green
      exit 0
    }
  } else {
    Write-Host 'gh belum login. Jalankan: gh auth login' -ForegroundColor Yellow
  }
}

if (-not $RepoUrl) {
  throw 'RepoUrl belum diisi dan gh CLI tidak siap. Buat repo kosong di GitHub lalu jalankan lagi dengan -RepoUrl.'
}

$existing = git remote get-url origin 2>$null
if ($existing) {
  git remote set-url origin $RepoUrl
} else {
  git remote add origin $RepoUrl
}
git branch -M main
git push -u origin main
Write-Host "Push selesai ke $RepoUrl" -ForegroundColor Green
Write-Host 'PENTING: jangan force-push setelah freeze; riwayat commit adalah bukti freeze.' -ForegroundColor Yellow
