-- Fix constraint naming: migrations 00073 and 00074 assumed the auto-generated
-- constraint names from inline CHECK definitions in 00018. If the names didn't
-- match, the old constraints were never dropped, causing conflicts that block
-- 'interested' RSVPs and 'biweekly'/'yearly' recurrence values.
--
-- This migration drops ALL check constraints on both columns and re-adds clean ones.

-- 1. Fix events.recurrence constraint
-- Drop any auto-generated or explicitly named recurrence check constraints
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'events'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%recurrence%'
  LOOP
    EXECUTE format('ALTER TABLE public.events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$$;

ALTER TABLE public.events ADD CONSTRAINT events_recurrence_check
  CHECK (recurrence IN ('none', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly'));

-- 2. Fix event_rsvps.status constraint
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'event_rsvps'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.event_rsvps DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$$;

ALTER TABLE public.event_rsvps ADD CONSTRAINT event_rsvps_status_check
  CHECK (status IN ('interested', 'going', 'maybe', 'not_going', 'waitlist'));
