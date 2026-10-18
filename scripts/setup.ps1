$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host "`n== Lume: instalação ==" -ForegroundColor Green

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js não encontrado. Instalando o Node.js LTS via winget..." -ForegroundColor Yellow
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  Write-Host "`nNode.js instalado. FECHE esta janela, abra um novo terminal e rode setup.bat novamente." -ForegroundColor Yellow
  exit 0
}

$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) { throw "Node.js 20 ou superior é necessário (encontrado: $(node -v))." }

if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env'; Write-Host "Criado .env a partir de .env.example" }

npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install falhou' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build falhou' }

Write-Host "`nPronto! Rode start.bat para iniciar o servidor." -ForegroundColor Green
