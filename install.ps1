$ErrorActionPreference = "Stop"

Write-Host "Installing Drop-in Enterprise Agent Engine..." -ForegroundColor Cyan

npm install
npm run build
npm link

Write-Host "Installation Complete!" -ForegroundColor Green
Write-Host "You can now use the 'agent-engine' command globally." -ForegroundColor Cyan
