import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

serve(async (req) => {
  console.log('=== FUNÇÃO POLL VIDEO STATUS ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verificar variáveis de ambiente
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

    console.log('Environment check:');
    console.log('- SUPABASE_URL:', !!supabaseUrl);
    console.log('- SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
    console.log('- GEMINI_API_KEY:', !!geminiApiKey);

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables not configured');
    }

    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Criar cliente Supabase com service role key
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Supabase client created with service role');
    console.log('Polling video status...');

    // Get all processing videos from last 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    
    const { data: processingVideos, error: selectError } = await supabaseClient
      .from('videos')
      .select('*')
      .eq('status', 'processing')
      .not('operation_name', 'is', null)
      .gte('created_at', twoHoursAgo);

    if (selectError) {
      console.error('Database select error:', selectError);
      throw new Error(`Database error: ${selectError.message}`);
    }

    if (!processingVideos || processingVideos.length === 0) {
      console.log('No processing videos found');
      return new Response(JSON.stringify({
        success: true,
        message: 'No processing videos found',
        checked: 0,
        results: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Found ${processingVideos.length} processing videos`);

    const results = [];
    let successCount = 0;
    let failedCount = 0;
    let stillProcessingCount = 0;

    for (const video of processingVideos) {
      try {
        console.log(`Checking status for video ${video.id} with operation ${video.operation_name}`);
        
        // Check operation status using the correct endpoint format
        const statusUrl = `https://generativelanguage.googleapis.com/v1beta/${video.operation_name}`;
        const statusResponse = await fetch(statusUrl, {
          method: 'GET',
          headers: {
            'x-goog-api-key': geminiApiKey
          }
        });

        console.log(`Status response for video ${video.id}: ${statusResponse.status}`);

        if (!statusResponse.ok) {
          console.error(`Status check failed for video ${video.id}: ${statusResponse.status}`);
          const errorText = await statusResponse.text();
          console.error('Error details:', errorText);
          
          results.push({
            id: video.id,
            status: 'check_failed',
            error: `HTTP ${statusResponse.status}: ${errorText}`
          });
          continue;
        }

        const operationData = await statusResponse.json();
        console.log(`Operation data for video ${video.id}:`, JSON.stringify(operationData, null, 2));

        if (operationData.done === true) {
          // Operation is complete - check for video in the response
          if (operationData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri) {
            // Video generation completed successfully
            const videoUri = operationData.response.generateVideoResponse.generatedSamples[0].video.uri;
            console.log(`Video ${video.id} completed successfully with URI: ${videoUri}`);

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
              results.push({
                id: video.id,
                status: 'update_failed',
                error: updateError.message
              });
            } else {
              successCount++;
              results.push({
                id: video.id,
                status: 'completed',
                video_uri: videoUri
              });

              // Save AI response about completion
              try {
                await supabaseClient.from('prompts').insert({
                  user_id: video.user_id,
                  content: `Your video "${video.title}" has been generated successfully! You can now view it.`,
                  type: 'assistant',
                  video_id: video.id
                });
              } catch (promptError) {
                console.error('Error saving completion message:', promptError);
              }
            }
          } 
          else if (operationData.error) {
            // Video generation failed with specific error
            const errorMessage = operationData.error.message || 'Unknown API error';
            console.log(`Video ${video.id} failed with error: ${errorMessage}`);

            const { error: updateError } = await supabaseClient
              .from('videos')
              .update({
                status: 'failed',
                error_message: errorMessage,
                completed_at: new Date().toISOString()
              })
              .eq('id', video.id);

            if (updateError) {
              console.error(`Failed to update failed video ${video.id}:`, updateError);
              results.push({
                id: video.id,
                status: 'update_failed',
                error: updateError.message
              });
            } else {
              failedCount++;
              results.push({
                id: video.id,
                status: 'failed',
                error: errorMessage
              });

              // Save AI response about failure
              try {
                await supabaseClient.from('prompts').insert({
                  user_id: video.user_id,
                  content: `Unfortunately, the generation of your video "${video.title}" failed. Error: ${errorMessage}. Please try again.`,
                  type: 'assistant',
                  video_id: video.id
                });
              } catch (promptError) {
                console.error('Error saving failure message:', promptError);
              }
            }
          } 
          else {
            // Operation done but no video or error - treat as failed
            const errorMessage = 'Video generation completed but no video was produced';
            console.log(`Video ${video.id}: ${errorMessage}`);

            const { error: updateError } = await supabaseClient
              .from('videos')
              .update({
                status: 'failed',
                error_message: errorMessage,
                completed_at: new Date().toISOString()
              })
              .eq('id', video.id);

            if (updateError) {
              console.error(`Failed to update video ${video.id}:`, updateError);
              results.push({
                id: video.id,
                status: 'update_failed',
                error: updateError.message
              });
            } else {
              failedCount++;
              results.push({
                id: video.id,
                status: 'failed',
                error: errorMessage
              });
            }
          }
        } else {
          // Still processing
          console.log(`Video ${video.id} still processing`);
          stillProcessingCount++;
          results.push({
            id: video.id,
            status: 'processing',
            progress: operationData.metadata?.progressPercentage || null
          });
        }

      } catch (error) {
        console.error(`Error checking video ${video.id}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          id: video.id,
          status: 'check_error',
          error: errorMessage
        });
      }
    }

    const summary = {
      total: processingVideos.length,
      completed: successCount,
      failed: failedCount,
      stillProcessing: stillProcessingCount,
      errors: results.filter(r => r.status.includes('failed') || r.status.includes('error')).length
    };

    console.log('Poll summary:', summary);

    return new Response(JSON.stringify({
      success: true,
      summary,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('=== ERRO NA FUNÇÃO POLL ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : 'No stack trace available'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});