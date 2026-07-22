-- Allow authenticated users to delete their own notifications.
-- Previously only SELECT and UPDATE policies existed, so client-side
-- .delete() calls were silently rejected by RLS.

CREATE POLICY "Users delete own notifications"
  ON notifications FOR DELETE
  USING (auth.uid() = user_id);
