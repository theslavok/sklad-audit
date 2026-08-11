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
```

**Важно:** публичную политику на `DELETE` не создавайте. Удалять записи из облака может только администратор по паролю (см. шаг 3).

## 3. Защита удаления (пароль администратора)

Выполните в SQL Editor. **Замените** `ВАШ_СЕКРЕТНЫЙ_ПАРОЛЬ` на свой пароль (его знает только вы):

```sql
-- Убрать открытое удаление, если оно уже было включено раньше
drop policy if exists "audits_delete_public" on public.audits;

create or replace function public.delete_audit(p_id uuid, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_password is distinct from 'ВАШ_СЕКРЕТНЫЙ_ПАРОЛЬ' then
    raise exception 'Неверный пароль';
  end if;
  delete from public.audits where id = p_id;
  return true;
end;
$$;

revoke all on function public.delete_audit(uuid, text) from public;
grant execute on function public.delete_audit(uuid, text) to anon, authenticated;
```

После этого:
- сотрудники по-прежнему могут **смотреть** и **сохранять** аудиты;
- **удалить** из облака можно только введя ваш пароль на сайте (кнопка «Удалить» в «Истории»);
- пароль **не хранится** в коде сайта — только в базе Supabase.

Чтобы сменить пароль позже — снова выполните `create or replace function ...` с новым значением.

Удалять записи можно и вручную в Supabase: Table Editor → `audits`.

## 4. Скопируйте ключи

Project Settings → API:
- Project URL
- anon public key

## 5. Вставьте в сайт

Откройте файл `cloud-config.js` и заполните:

```js
window.CLOUD_CONFIG = {
  supabaseUrl: "https://XXXX.supabase.co",
  supabaseAnonKey: "eyJhbGciOi...",
};
```

Закоммитьте и запушьте на GitHub (или загрузите файл в репозиторий).

## 6. Как пользоваться

1. Пройдите аудит.
2. Нажмите «Сохранить текущий аудит» — появится **ссылка для команды**.
3. Другой участник открывает эту ссылку или код на стартовом экране.
4. Вкладка «История» подтягивает общие записи из облака.
5. Удаление из облака запрашивает пароль администратора.

Пока `cloud-config.js` пустой, сайт работает, но история остаётся только на устройстве.
