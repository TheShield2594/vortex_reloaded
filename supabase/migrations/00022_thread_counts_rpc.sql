-- Thread counts grouped by parent channel for a server.
CREATE OR REPLACE FUNCTION public.get_thread_counts_by_channel(p_server_id UUID)
RETURNS TABLE(parent_channel_id UUID, count BIGINT) AS $$
  SELECT t.parent_channel_id, COUNT(*)::BIGINT AS count
  FROM public.threads t
  JOIN public.channels c ON c.id = t.parent_channel_id
  WHERE t.archived = FALSE
    AND c.server_id = p_server_id
  GROUP BY t.parent_channel_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
