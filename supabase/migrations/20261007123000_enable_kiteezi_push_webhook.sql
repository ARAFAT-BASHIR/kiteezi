-- Ensure every Kiteezi notification is delivered to subscribed devices as a Web Push notification.
-- The edge function validates the webhook secret and performs the actual Web Push delivery.

create extension if not exists pg_net with schema extensions;

create schema if not exists private;

create or replace function private.enqueue_kiteezi_push()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, private
as $$
declare
  cfg record;
  payload jsonb;
begin
  select public_key, webhook_secret, active
    into cfg
    from public.push_config
   where key = 'default'
   limit 1;

  if coalesce(cfg.active, false) and coalesce(cfg.webhook_secret, '') <> '' then
    payload := jsonb_build_object(
      'type', 'INSERT',
      'table', 'notifications',
      'schema', 'public',
      'record', to_jsonb(NEW),
      'old_record', null
    );

    perform net.http_post(
      url := 'https://aldpezvbetliuvagiekg.supabase.co/functions/v1/kiteezi-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-kiteezi-webhook-secret', cfg.webhook_secret
      ),
      body := payload
    );
  end if;

  return NEW;
end;
$$;

revoke all on function private.enqueue_kiteezi_push() from public;

drop trigger if exists trg_notifications_kiteezi_push on public.notifications;

create trigger trg_notifications_kiteezi_push
after insert on public.notifications
for each row
execute function private.enqueue_kiteezi_push();
