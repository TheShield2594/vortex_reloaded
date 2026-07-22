-- Enable real-time delivery for the notifications table so that the in-app
-- notification bell receives live INSERT events without a page refresh.
-- The table was created in 00011 but was inadvertently omitted from the
-- supabase_realtime publication, causing the client-side subscription to
-- receive no events for new mentions, replies, or system notifications.
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
