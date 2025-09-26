import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get required environment variables
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    console.log('Polling video status...');

    // Get all processing videos
    const { data: processingVideos, error: selectError } = await supabaseClient
      .from('videos')
      .select('*')
      .eq('status', 'processing')
      .not('operation_name', 'is', null)
      .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()); // Only videos from last 2 hours

    if (selectError) {
      throw selectError;
    }

    if (!processingVideos || processingVideos.length === 0) {
      console.log('No processing videos found');
      return new Response(
        JSON.stringify({ message: 'No processing videos found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${processingVideos.length} processing videos`);

    const results = [];

    for (const video of processingVideos) {
      try {
        console.log(`Checking status for video ${video.id} with operation ${video.operation_name}`);

        // Check operation status
        const statusResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/${video.operation_name}`, {
          method: 'GET',
          headers: {
            'x-goog-api-key': geminiApiKey
          }
        });

        if (!statusResponse.ok) {
          console.error(`Status check failed for video ${video.id}:`, statusResponse.status);
          continue;
        }

        const operationData = await statusResponse.json();
        
        if (operationData.done === true) {
          if (operationData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri) {
            // Video generation completed successfully
            const videoUri = operationData.response.generateVideoResponse.generatedSamples[0].video.uri;
            
            console.log(`Video ${video.id} completed successfully`);

            // Update video record as completed
            const { error: updateError } = await supabaseClient
              .from('videos')
              .update({
                status: 'completed',
                video_uri: videoUri,
                completed_at: new Date().toISOString()
              })
              .eq('id', video.id);

            if (updateError) {
              console.error(`Failed to update video ${video.id}:`, updateError);
            } else {
              results.push({ id: video.id, status: 'completed', video_uri: videoUri });
            }
          } else if (operationData.error) {
            // Video generation failed
            console.log(`Video ${video.id} failed:`, operationData.error.message);

            const { error: updateError } = await supabaseClient
              .from('videos')
              .update({
                status: 'failed',
                error_message: operationData.error.message || 'Unknown error'
              })
              .eq('id', video.id);

            if (updateError) {
              console.error(`Failed to update failed video ${video.id}:`, updateError);
            } else {
              results.push({ id: video.id, status: 'failed', error: operationData.error.message });
            }
          } else {
            // Operation done but no video or error - treat as failed
            console.log(`Video ${video.id} completed but no video generated`);

            const { error: updateError } = await supabaseClient
              .from('videos')
              .update({
                status: 'failed',
                error_message: 'Video generation completed but no video was produced'
              })
              .eq('id', video.id);

            if (updateError) {
              console.error(`Failed to update video ${video.id}:`, updateError);
            } else {
              results.push({ id: video.id, status: 'failed', error: 'No video produced' });
            }
          }
        } else {
          console.log(`Video ${video.id} still processing`);
          results.push({ id: video.id, status: 'processing' });
        }
      } catch (error) {
        console.error(`Error checking video ${video.id}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ id: video.id, status: 'error', error: errorMessage });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        checked: processingVideos.length, 
        results: results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error in poll-video-status function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});