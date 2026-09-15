# LinkAI Backend

Бекенд для сервісу LinkAI на базі **FastAPI** та **Supabase**.

## 🚀 Швидкий старт

### 1. Створення та активація віртуального середовища
```bash
python -m venv .venv
source .venv/bin/activate  # На Linux/macOS
# або .venv\Scripts\activate  # На Windows
```

### 2. Встановлення залежностей
```bash
pip install -r requirements.txt
```

### 3. Налаштування змінних середовища
Створіть або відредагуйте файл `.env`:
```env
SUPABASE_URL="https://your-project-ref.supabase.co"
SUPABASE_KEY="your-anon-or-service-role-key"
```

### 4. Створення таблиці користувачів у Supabase
1. Відкрийте ваш проект у [Supabase Dashboard](https://supabase.com/dashboard).
2. Перейдіть у розділ **SQL Editor** -> **New query**.
3. Скопіюйте та виконайте вміст файлу `app/db/schema.sql`.

### 5. Запуск сервера розробки
```bash
uvicorn main:app --reload
```
Після запуску відкрийте:
- Документація Swagger UI: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Альтернативна документація ReDoc: [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)
- Health check: [http://127.0.0.1:8000/api/v1/health](http://127.0.0.1:8000/api/v1/health)

---

## 📁 Структура проекту

```text
linkai_backend/
├── app/
│   ├── api/
│   │   ├── deps.py               # Dependency Injection (Supabase, UserService)
│   │   └── v1/
│   │       ├── endpoints/
│   │       │   ├── health.py     # Перевірка стану сервера
│   │       │   └── users.py      # CRUD операції з користувачами
│   │       └── router.py         # Маршрутизатор API v1
│   ├── core/
│   │   └── config.py             # Налаштування Pydantic Settings
│   ├── db/
│   │   ├── schema.sql            # SQL-скрипт створення таблиці users у Supabase
│   │   └── supabase.py           # Клієнт підключення до Supabase
│   ├── schemas/
│   │   ├── common.py             # Загальні відповіді API
│   │   └── user.py               # Pydantic моделі користувача (DTO)
│   └── services/
│       └── user_service.py       # Сервісний шар для роботи з базою даних Supabase
├── .env.example
├── .gitignore
├── main.py                       # Точка входу FastAPI додатку
└── requirements.txt
```
