$ErrorActionPreference = 'Stop'
$port = 3000
if (Test-Path (Join-Path $PSScriptRoot '..\.env')) {
  $line = Select-String -Path (Join-Path $PSScriptRoot '..\.env') -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
  if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
}

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host 'Instalando cloudflared via winget...' -ForegroundColor Yellow
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  Write-Host "`ncloudflared instalado. FECHE esta janela, abra um novo terminal e rode tunnel.bat novamente." -ForegroundColor Yellow
  exit 0
}

Write-Host "`nCriando túnel HTTPS para http://localhost:$port ..." -ForegroundColor Green
Write-Host "Procure a linha com https://<algo>.trycloudflare.com e ABRA ESSE ENDEREÇO no seu navegador para transmitir." -ForegroundColor Yellow
Write-Host "Os convites gerados por ele já usarão o endereço público.`n"
cloudflared tunnel --url "http://localhost:$port" --no-autoupdate
