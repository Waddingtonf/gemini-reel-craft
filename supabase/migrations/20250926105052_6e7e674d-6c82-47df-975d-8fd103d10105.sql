-- Enable realtime for videos table
ALTER TABLE public.videos REPLICA IDENTITY FULL;

-- Add videos table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE videos;

-- Create cron job to call the poll-video-status edge function every minute
SELECT cron.schedule(
  'poll-video-status-cron',
  '* * * * *', -- every minute
  $$
  SELECT net.http_post(
      url:='https://ymypagxsscvaliipwqvo.supabase.co/functions/v1/poll-video-status',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlteXBhZ3hzc2N2YWxpaXB3cXZvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODgwODgzOSwiZXhwIjoyMDc0Mzg0ODM5fQ.WS9kWNaOdV2D2v9XHraImJx4pMm7k2GxiHsKfyyAPys"}'::jsonb,
      body:='{}'::jsonb
  ) as request_id;
  $$
);