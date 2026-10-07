-- The legacy database webhook called a removed helper schema and broke order creation.
-- Notifications are still stored normally; the obsolete trigger is no longer used.
drop trigger if exists notifications_push_webhook on public.notifications;
drop function if exists public.kiteezi_push_notification_webhook();
