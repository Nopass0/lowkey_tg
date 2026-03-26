#!/bin/bash
# start.sh - Скрипт запуска бота Lowkey VPN

echo "🚀 Настройка окружения..."

# Проверка .env
if [ ! -f .env ]; then
    echo "❌ Ошибка: Файл .env не найден! Создайте его из .env.example"
    exit 1
fi

# Установка зависимостей
echo "📦 Установка зависимостей..."
bun install

# Запуск через PM2
echo "🤖 Запуск бота в PM2..."
pm2 start index.ts --name "lowkey-vpn-bot" --interpreter bun --watch

echo "✅ Бот запущен! Используйте 'pm2 logs lowkey-vpn-bot' для просмотра логов."
