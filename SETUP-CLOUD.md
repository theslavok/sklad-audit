# Общее хранение аудитов (Supabase)

Сайт на GitHub Pages — статический. Чтобы результаты видели все по ссылке, нужна бесплатная облачная база.

## 1. Создайте проект

1. Зайдите на [https://supabase.com](https://supabase.com) и создайте аккаунт.
2. New project → имя, например `sklad-audit` → Create.

## 2. Создайте таблицу

В SQL Editor выполните:

```sql
create table if not exists public.audits (
  id uuid primary key default gen_random_uuid(),
  share_code text unique not null,
  created_at timestamptz not null default now(),
  auditor text,
  audit_date text,
  payload jsonb not null
);

alter table public.audits enable row level security;

create policy "audits_select_public"
  on public.audits for select
  using (true);

create policy "audits_insert_public"
  on public.audits for insert
  with check (true);

create policy "audits_delete_public"
  on public.audits for delete
  using (true);
```

## 3. Скопируйте ключи

Project Settings → API:
- Project URL
- anon public key

## 4. Вставьте в сайт

Откройте файл `cloud-config.js` и заполните:

```js
window.CLOUD_CONFIG = {
  supabaseUrl: "https://XXXX.supabase.co",
  supabaseAnonKey: "eyJhbGciOi...",
};
```

Закоммитьте и запушьте на GitHub (или загрузите файл в репозиторий).

## 5. Как пользоваться

1. Пройдите аудит.
2. Нажмите «Сохранить текущий аудит» — появится **ссылка для команды**.
3. Другой участник открывает эту ссылку или код на стартовом экране.
4. Вкладка «История» подтягивает общие записи из облака.

Пока `cloud-config.js` пустой, сайт работает, но история остаётся только на устройстве.
