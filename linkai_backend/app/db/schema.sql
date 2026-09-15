-- ==============================================================================
-- LinkAI Database Schema: Users Table (tailored for LinkAI VS Code Client)
-- ==============================================================================
-- Цей SQL-скрипт можна виконати у Supabase Dashboard -> SQL Editor

-- 1. Створення функції для автоматичного оновлення колонки updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Створення таблиці users (користувачі LinkAI)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    username VARCHAR(100) UNIQUE,
    full_name VARCHAR(255),
    avatar_url TEXT,
    
    -- Токен доступу для LinkAI VS Code розширення (linkai.backendToken)
    api_token VARCHAR(255) UNIQUE,

    -- Налаштування користувача, синхронізовані з LinkAI Client (package.json / extension.ts)
    default_language VARCHAR(50) NOT NULL DEFAULT 'TypeScript'
        CHECK (default_language IN ('TypeScript', 'JavaScript', 'Python', 'Java', 'C#', 'Go', 'C++', 'Інша')),
    default_period INT NOT NULL DEFAULT 30
        CHECK (default_period IN (7, 30, 90)),
    include_comments BOOLEAN NOT NULL DEFAULT FALSE,
    send_aggregated_statistics BOOLEAN NOT NULL DEFAULT TRUE,
    excluded_paths TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    -- Метадані активності
    last_check_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Міграція для існуючої таблиці (якщо таблиця вже створена раніше без password_hash):
-- ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- 3. Створення індексів для швидкого пошуку
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_users_api_token ON public.users(api_token);

-- 4. Створення тригера для автоматичного оновлення updated_at
DROP TRIGGER IF EXISTS set_users_updated_at ON public.users;
CREATE TRIGGER set_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 5. Налаштування Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Дозволити доступ на читання
CREATE POLICY "Allow select for service role and users" 
    ON public.users
    FOR SELECT 
    USING (true);

-- Дозволити вставку нових користувачів
CREATE POLICY "Allow insert for service role and users" 
    ON public.users
    FOR INSERT 
    WITH CHECK (true);

-- Дозволити оновлення
CREATE POLICY "Allow update for service role and users" 
    ON public.users
    FOR UPDATE 
    USING (true);

-- Дозволити видалення
CREATE POLICY "Allow delete for service role" 
    ON public.users
    FOR DELETE 
    USING (true);
