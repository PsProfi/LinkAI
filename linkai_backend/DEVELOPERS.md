# LinkAI Backend — документація для розробників

Бекенд для VS Code розширення LinkAI. Написаний на FastAPI + Python, база даних — Supabase (PostgreSQL), AI-інтеграція через OpenAI-сумісний API (Gemini або OpenAI).

---

## Як запустити

```bash
cd linkai_backend

# Перший запуск — створити venv і встановити залежності
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Скопіювати конфіг і заповнити ключі
cp .env.example .env
# відкрити .env і вставити SUPABASE_URL, SUPABASE_KEY, GEMINI_API_KEY або OPENAI_API_KEY

# Запустити
python main.py
# або в режимі авто-перезавантаження при зміні файлів
uvicorn main:app --reload
```

Після старту:
- API: `https://localhost:8000`
- Swagger UI (інтерактивна документація): `https://localhost:8000/docs`
- ReDoc: `https://localhost:8000/redoc`

> HTTPS вмикається автоматично в режимі розробки — бекенд сам генерує самопідписаний сертифікат у папці `certs/`. Браузер покаже попередження — це нормально для localhost. VS Code розширення (linkai client) вимагає HTTPS, тому так і задумано.

---

## Структура проекту

```
linkai_backend/
├── main.py                    # точка входу, FastAPI app, CORS, uvicorn
├── requirements.txt
├── .env                       # реальні ключі (не комітити)
├── .env.example               # шаблон для нових розробників
├── certs/                     # самопідписані сертифікати (генеруються автоматично)
└── app/
    ├── core/
    │   ├── config.py          # усі налаштування через pydantic-settings
    │   ├── security.py        # хешування паролів, JWT, генерація api_token
    │   └── ssl.py             # авто-генерація self-signed сертифіката
    ├── db/
    │   └── schema.sql         # SQL для Supabase — запустити один раз вручну
    ├── api/
    │   ├── deps.py            # FastAPI Depends: get_current_user, get_user_service
    │   └── v1/
    │       ├── router.py      # збирає всі роутери в один
    │       └── endpoints/
    │           ├── health.py  # GET /health
    │           ├── auth.py    # POST /auth/register, /auth/login, GET /auth/me
    │           ├── users.py   # CRUD для користувачів
    │           └── ai.py      # POST /ai/evaluate — головний AI ендпоінт
    ├── schemas/
    │   ├── auth.py            # UserRegister, UserLogin, Token
    │   ├── user.py            # UserCreate, UserUpdate, UserResponse
    │   └── ai.py              # AiRequest, AiEvaluation, Summary
    └── services/
        ├── user_service.py    # вся логіка роботи з користувачами через Supabase
        └── ai_service.py      # виклик AI (Gemini / OpenAI), системний промпт, retry
```

---

## Як це все працює

### Запит від VS Code розширення

Розширення linkai client відстежує зміни в коді і агрегує статистику локально (кількість доданих/видалених рядків, активні дні, сесії). Коли користувач натискає "Перевірити" — клієнт надсилає POST запит на бекенд з агрегованими даними поточного і попереднього аналогічного періоду. Бекенд передає це до AI і повертає оцінку прогресу.

### Аутентифікація

Є два типи токенів, і обидва підтримуються одночасно:

**JWT (access_token)** — стандартний Bearer токен. Видається при `/auth/login` або `/auth/register`. Живе 30 днів (по дефолту, регулюється `ACCESS_TOKEN_EXPIRE_MINUTES`). Підписаний HS256 із `JWT_SECRET_KEY`.

**API token (lai_...)** — окремий токен для VS Code розширення. Виглядає як `lai_<random>`. Користувач отримує його при реєстрації/логіні і вставляє в VS Code через команду `LinkAI: Set Backend Token`. Розширення відправляє його в `Authorization: Bearer` заголовку при кожному запиті до `/ai/evaluate`.

`deps.py` → `get_current_user` намагається спочатку розпарсити токен як JWT, якщо не виходить — шукає його в базі як `api_token`. Якщо і так не знаходить — 401.

### Паролі

Хешуються через PBKDF2-HMAC-SHA256 з 600 000 ітерацій і випадковим 32-байтним salt. Формат в базі: `pbkdf2_sha256$600000$<salt>$<hash>`. Бібліотека `bcrypt` не використовується, все на стандартній бібліотеці Python (`hashlib`, `hmac`).

### База даних — Supabase

Supabase — це hosted PostgreSQL з REST API (PostgREST). Бекенд підключається через офіційний Python SDK `supabase`. SQL-схема таблиці знаходиться в `app/db/schema.sql` — її треба запустити вручну у Supabase Dashboard → SQL Editor один раз при першому розгортанні.

Таблиця `users` зберігає:
- стандартні поля (email, password_hash, username, avatar_url)
- `api_token` — токен для VS Code розширення
- налаштування LinkAI client (default_language, default_period, include_comments, excluded_paths, send_aggregated_statistics)
- `last_check_at` — коли востаннє робили AI-оцінку

Row Level Security (RLS) увімкнено, але всі операції дозволені — захист відбувається на рівні бекенду.

`user_service.py` — єдиний файл, який безпосередньо читає і пише в базу. Якщо треба змінити логіку роботи з даними — все тут.

---

## AI інтеграція

### Ендпоінт

```
POST /api/v1/ai/evaluate
Authorization: Bearer <api_token або JWT>
Content-Type: application/json
```

Тіло запиту (точно відповідає `AiRequest` у linkai client):
```json
{
  "language": "TypeScript",
  "periodDays": 30,
  "current": {
    "linesAdded": 450,
    "linesDeleted": 120,
    "linesChanged": 570,
    "activeDays": 12,
    "sessions": 18,
    "averageLinesPerActiveDay": 37.5
  },
  "previous": {
    "linesAdded": 310,
    "linesDeleted": 90,
    "linesChanged": 400,
    "activeDays": 8,
    "sessions": 11,
    "averageLinesPerActiveDay": 38.75
  }
}
```

Відповідь (точно відповідає `AiEvaluation` у linkai client):
```json
{
  "score": 74,
  "trend": "improving",
  "summary": "Хороший прогрес за місяць...",
  "strengths": ["Стабільна активність", "Зріст обсягу коду"],
  "recommendations": ["Збільшити кількість активних днів"],
  "confidence": "medium"
}
```

### Провайдери та перемикання

Конфігурується змінною `AI_PROVIDER` у `.env`:

**`AI_PROVIDER="gemini"`** — Gemini 3.6 Flash як єдиний провайдер. Використовується прямо зараз, бо OpenAI баланс вичерпаний.

**`AI_PROVIDER="openai"`** — OpenAI як основний. Якщо OpenAI повертає 401 (вичерпаний баланс або невалідний ключ) — автоматично перемикається на Gemini. Це fallback.

Технічно обидва провайдери використовують один і той самий `openai` Python SDK. Для Gemini просто задається інший `base_url`:
```
https://generativelanguage.googleapis.com/v1beta/openai/
```
Google підтримує OpenAI-сумісний API, тому окрема бібліотека не потрібна.

### Retry логіка

При помилках `RateLimitError` (503 high demand), `APITimeoutError`, `APIConnectionError` — бекенд автоматично повторює запит з exponential backoff:
- Спроба 1 → чекає 2 сек → Спроба 2 → чекає 4 сек → Спроба 3
- Якщо всі 3 спроби провалились — повертає клієнту 503

Помилки `AuthenticationError` (401) — не повторюються, одразу переходять до fallback або повертають помилку.

### Системний промпт

Знаходиться в `ai_service.py` у константі `SYSTEM_PROMPT`. Налаштований спеціально під метрики linkai client:
- пояснює AI структуру вхідних даних
- задає правила скорингу (0–100)
- задає логіку тренду (±10% зміна = improving/declining)
- задає логіку confidence (на основі activeDays і sessions)
- вимагає відповіді у plain JSON без markdown
- вимагає тексту українською мовою

Якщо Gemini все одно повертає відповідь у markdown-огорожі (` ```json ``` `) — функція `_extract_json()` автоматично її прибирає перед парсингом.

---

## Налаштування (.env)

| Змінна | За замовчуванням | Опис |
|--------|-----------------|------|
| `ENVIRONMENT` | `development` | `development` або `production` |
| `DEBUG` | `True` | увімкнути debug-режим uvicorn |
| `PORT` | `8000` | порт сервера |
| `HTTPS_ENABLED` | `True` | якщо `True` — стартує на HTTPS |
| `JWT_SECRET_KEY` | (необхідно змінити) | секрет для підпису JWT |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `43200` | 30 днів |
| `SUPABASE_URL` | — | URL Supabase проекту |
| `SUPABASE_KEY` | — | anon або service_role ключ |
| `AI_PROVIDER` | `gemini` | `gemini` або `openai` |
| `GEMINI_API_KEY` | — | ключ з aistudio.google.com |
| `GEMINI_MODEL` | `gemini-3.6-flash` | модель Gemini |
| `OPENAI_API_KEY` | — | ключ з platform.openai.com |
| `OPENAI_MODEL` | `gpt-4o-mini` | модель OpenAI |
| `OPENAI_TEMPERATURE` | `0.4` | температура генерації (0–1) |
| `OPENAI_MAX_TOKENS` | `1024` | мінімум, бекенд використовує max(це, 2048) |

---

## SSL / HTTPS

При старті `main.py` викликає `get_ssl_context_files()` з `ssl.py`. Логіка така:

1. Якщо `HTTPS_ENABLED=False` — стартує на HTTP (для деяких хмарних середовищ не потрібно).
2. Якщо задані `SSL_KEYFILE` і `SSL_CERTFILE` і файли існують — використовує їх (для продакшна з реальним сертифікатом).
3. Якщо нічого не задано — автоматично генерує самопідписаний RSA-2048 сертифікат у `certs/cert.pem` і `certs/key.pem`. Генерується один раз, при наступних запусках файли просто перевикористовуються.

Самопідписаний сертифікат діє 1 рік і видається для `localhost`, `127.0.0.1`, `0.0.0.0`.

---

## Маршрути API

Всі маршрути доступні з префіксом `/api/v1`.

### Health

| Метод | Шлях | Опис |
|-------|------|------|
| GET | `/health` | перевірка що сервер живий |

### Auth

| Метод | Шлях | Потребує токен | Опис |
|-------|------|----------------|------|
| POST | `/auth/register` | ні | реєстрація, повертає JWT + api_token |
| POST | `/auth/login` | ні | логін, повертає JWT + api_token |
| GET | `/auth/me` | так | профіль поточного користувача |
| DELETE | `/auth/me` | так | видалити свій акаунт |

### Users

| Метод | Шлях | Опис |
|-------|------|------|
| GET | `/users/me` | свій профіль |
| PATCH | `/users/me` | оновити свої налаштування |
| DELETE | `/users/me` | видалити себе |
| POST | `/users/me/token/regenerate` | перегенерувати api_token |
| GET | `/users/` | список всіх користувачів (limit/offset) |
| POST | `/users/` | створити користувача |
| GET | `/users/{user_id}` | знайти по UUID |
| PATCH | `/users/{user_id}` | оновити по UUID |
| DELETE | `/users/{user_id}` | видалити по UUID |

### AI

| Метод | Шлях | Потребує токен | Опис |
|-------|------|----------------|------|
| POST | `/ai/evaluate` | так | AI-оцінка прогресу розробника |

---

## Як додавати нові ендпоінти

1. Створити файл в `app/api/v1/endpoints/my_feature.py`
2. Оголосити `router = APIRouter(prefix="/my-feature", tags=["My Feature"])`
3. Написати ендпоінти
4. У `app/api/v1/router.py` додати:
   ```python
   from app.api.v1.endpoints import my_feature
   api_router.include_router(my_feature.router)
   ```
5. Якщо потрібні нові схеми — додати в `app/schemas/`
6. Якщо потрібна нова бізнес-логіка — додати сервіс в `app/services/`

---

## База даних — перший запуск

Таблиця в Supabase не створюється автоматично. Треба зробити один раз:

1. Відкрити Supabase Dashboard → SQL Editor
2. Скопіювати вміст `app/db/schema.sql`
3. Виконати

Якщо таблиця `users` вже існує але без колонки `password_hash` (рання версія) — є закомантована міграція в кінці схеми:
```sql
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
```

---

## Де що шукати при відлагодженні

**503 від AI ендпоінта** — Gemini/OpenAI перевантажені. Бекенд повторить 3 рази автоматично. Якщо знову 503 — просто спробувати через хвилину, або переключити `AI_PROVIDER`.

**502 від AI ендпоінта** — AI повернув неправильний формат відповіді. Дивитись логи uvicorn — там буде `raw=` з тим, що реально прийшло. Зазвичай причина — обрізана відповідь (якщо `OPENAI_MAX_TOKENS` замалий) або модель змінила формат.

**401 на /ai/evaluate** — токен не пройшов. Або він прострочений (якщо JWT), або його немає в базі (якщо api_token). Перевірити через `/auth/me` чи токен взагалі валідний.

**404 при старті Gemini** — модель застаріла. Перевірити `GEMINI_MODEL` в `.env`. Актуальна на момент написання: `gemini-3.6-flash`.

**Помилка підключення до Supabase** — перевірити `SUPABASE_URL` і `SUPABASE_KEY` в `.env`. Перевірити що таблиця `users` існує в Supabase.
