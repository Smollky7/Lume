$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Test-Path 'server/dist/index.js') -or -not (Test-Path 'client/dist/index.html')) {
  Write-Host 'Primeira execução: instalando e compilando...' -ForegroundColor Yellow
  & (Join-Path $PSScriptRoot 'setup.ps1')
  if (-not (Test-Path 'server/dist/index.js')) { exit 1 }
}

Write-Host "`nLume em http://localhost:3000  (Ctrl+C para parar)" -ForegroundColor Green
Write-Host "Para convidar amigos de outras redes, rode tunnel.bat em outra janela.`n"
node server/dist/index.js
