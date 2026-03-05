#!/bin/bash
# stop.sh - Скрипт остановки бота Lowkey VPN

echo "🛑 Остановка бота в PM2..."
pm2 stop "lowkey-vpn-bot"
pm2 delete "lowkey-vpn-bot"

echo "✅ Бот остановлен и удален из списка PM2."
