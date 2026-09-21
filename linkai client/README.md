# LinkAI

LinkAI — VS Code-розширення для локального відстеження прогресу розробника. Воно агрегує зміни у файлах робочої області, показує динаміку за мовою та періодом і за явною дією користувача може надіслати лише агреговану статистику AI-бекенду.

## Використання

Відкрийте команду `LinkAI: Відкрити статистику` або панель LinkAI в Status Bar. Натисніть **Перевірити** для AI-оцінки.

## Налаштування

- `linkai.backendUrl` — HTTPS URL AI-бекенду; `localhost` дозволений для локальної розробки.
- `linkai.defaultLanguage` і `linkai.defaultPeriod` — початкові фільтри.
- `linkai.includeComments` — чи враховувати рядки коментарів.
- `linkai.sendAggregatedStatistics` — явний дозвіл на мережевий AI-запит, вимкнений за замовчуванням.
- `linkai.enableDataProcessing` — дозвіл на локальну обробку нових змін для статистики.
- `linkai.enableAchievements` — увімкнення простих локальних досягнень.
- `linkai.excludedPaths` — додаткові фрагменти шляхів для виключення.

Токен задається командою `LinkAI: Налаштувати токен AI-бекенду` і зберігається у VS Code `SecretStorage`. Сирий код, токени та повні запити не передаються у webview або логи.

## Розробка

```text
npm install
npm test
```

`npm test` виконує перевірку типів, webpack-збірку, lint і тести у VS Code.

## Запуск і тестування в розробці

1. Натиснути F5 на extension.ts або Start Debugging в Run And Debug
2. Натиснути на колонку LinkAI в Status Bar (внизу)
3. Config є в Activity Bar (збоку)

**Удачі**
