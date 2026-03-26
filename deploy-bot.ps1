# deploy-bot.ps1 - Startup script for the Telegram Bot

Write-Host "🚀 Starting Lowkey VPN Bot Deployment..." -ForegroundColor Cyan

# 1. Check for .env file
if (-Not (Test-Path ".env")) {
    Write-Host "❌ Error: .env file not found in the bot directory!" -ForegroundColor Red
    Write-Host "Please create a .env file based on the template (ADMIN_TG_ID, TELEGRAM_BOT_TOKEN, etc.)"
    exit 1
}

# 2. Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
bun install

# 3. Start with PM2
Write-Host "🌀 Starting bot via PM2..." -ForegroundColor Yellow

# Check if pm2 is installed
if (-Not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Host "⚠️ Warning: PM2 is not installed! Installing globally..." -ForegroundColor Cyan
    npm install -g pm2
}

# Start the bot
# Use --name to identify the process
pm2 start bun --name "lowkey-bot" -- run index.ts

Write-Host "✅ Bot is now running under PM2!" -ForegroundColor Green
Write-Host "Use 'pm2 status' to check, 'pm2 logs lowkey-bot' to see logs."
