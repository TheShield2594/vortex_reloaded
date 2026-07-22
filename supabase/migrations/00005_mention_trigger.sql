-- Mention count trigger
-- When a message is inserted with mentions, increment read_states.mention_count
-- for each mentioned user so their channel badge shows the count.

CREATE OR REPLACE FUNCTION public.handle_message_mentions()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Skip if no mentions
  IF NEW.mentions IS NULL OR jsonb_array_length(NEW.mentions) = 0 THEN
    RETURN NEW;
  END IF;

  FOR v_user_id IN
    SELECT jsonb_array_elements_text(NEW.mentions)::UUID
  LOOP
    -- Don't mention the author themselves
    IF v_user_id = NEW.author_id THEN
      CONTINUE;
    END IF;

    INSERT INTO public.read_states (user_id, channel_id, last_read_at, mention_count)
    VALUES (v_user_id, NEW.channel_id, '2000-01-01'::TIMESTAMPTZ, 1)
    ON CONFLICT (user_id, channel_id) DO UPDATE
      SET mention_count = public.read_states.mention_count + 1;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_message_mention
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_message_mentions();
