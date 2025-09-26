-- Update poll_veo_videos function to use correct status values and fix API endpoints
CREATE OR REPLACE FUNCTION public.poll_veo_videos()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    video_record RECORD;
    operation_status json;
    api_key text;
    http_response record;
BEGIN
    -- Get API key from environment
    api_key := current_setting('app.gemini_api_key', true);
    
    IF api_key IS NULL OR api_key = '' THEN
        RAISE NOTICE 'GEMINI_API_KEY not configured';
        RETURN;
    END IF;

    RAISE NOTICE 'Starting poll_veo_videos function';

    -- Loop through all processing videos
    FOR video_record IN 
        SELECT id, operation_name, user_id, title, created_at
        FROM videos 
        WHERE status = 'processing' 
        AND operation_name IS NOT NULL
        AND created_at > NOW() - INTERVAL '2 hours' -- Only check videos from last 2 hours
    LOOP
        BEGIN
            RAISE NOTICE 'Checking video %: %', video_record.id, video_record.operation_name;
            
            -- Make HTTP request to check status using the http extension
            SELECT * INTO http_response
            FROM http((
                'GET',
                'https://generativelanguage.googleapis.com/v1beta/' || video_record.operation_name,
                ARRAY[
                    http_header('x-goog-api-key', api_key)
                ],
                NULL,
                NULL
            ));

            -- Check if HTTP request was successful
            IF http_response.status >= 200 AND http_response.status < 300 THEN
                -- Parse the response content
                operation_status := http_response.content::json;

                -- Check if operation is done
                IF operation_status->>'done' = 'true' THEN
                    IF operation_status->'response'->'generateVideoResponse'->'generatedSamples'->0->'video'->>'uri' IS NOT NULL THEN
                        -- Mark as completed
                        UPDATE videos 
                        SET status = 'completed',
                            video_uri = operation_status->'response'->'generateVideoResponse'->'generatedSamples'->0->'video'->>'uri',
                            completed_at = NOW()
                        WHERE id = video_record.id;
                        
                        RAISE NOTICE 'Video % completed successfully', video_record.id;
                    ELSE
                        -- Mark as failed
                        UPDATE videos 
                        SET status = 'failed',
                            error_message = COALESCE(operation_status->'error'->>'message', 'No video URI in response')
                        WHERE id = video_record.id;
                        
                        RAISE NOTICE 'Video % failed - %', video_record.id, COALESCE(operation_status->'error'->>'message', 'No video URI in response');
                    END IF;
                ELSE
                    RAISE NOTICE 'Video % still processing', video_record.id;
                END IF;
            ELSE
                RAISE NOTICE 'HTTP error for video %: % %', video_record.id, http_response.status, http_response.content;
                
                -- If the operation is not found (404), mark as failed
                IF http_response.status = 404 THEN
                    UPDATE videos 
                    SET status = 'failed',
                        error_message = 'Operation not found'
                    WHERE id = video_record.id;
                    
                    RAISE NOTICE 'Video % marked as failed - operation not found', video_record.id;
                END IF;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error checking video %: %', video_record.id, SQLERRM;
        END;
    END LOOP;
    
    RAISE NOTICE 'Completed poll_veo_videos function';
END;
$function$;

-- Create a cron job to run the polling function every minute
SELECT cron.schedule('poll-veo-videos', '* * * * *', 'SELECT poll_veo_videos();');