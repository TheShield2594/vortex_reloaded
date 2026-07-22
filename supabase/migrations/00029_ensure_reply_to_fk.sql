-- Ensure the self-referential FK on messages.reply_to_id exists so that
-- PostgREST can expose the relationship for embedded queries.
-- The constraint may be absent when the database was provisioned without
-- running all migrations or when the schema cache is stale.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'messages_reply_to_id_fkey'
    AND    conrelid = 'public.messages'::regclass
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_reply_to_id_fkey
        FOREIGN KEY (reply_to_id)
        REFERENCES public.messages(id)
        ON DELETE SET NULL;
  END IF;
END $$;

-- Notify PostgREST to reload its schema cache so the new relationship
-- is immediately available for embedded queries.
NOTIFY pgrst, 'reload schema';
