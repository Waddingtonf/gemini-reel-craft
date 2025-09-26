import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateVideoRequest {
  prompt: string;
  title: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Get user from session
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { prompt, title }: GenerateVideoRequest = await req.json();

    if (!prompt || !title) {
      return new Response(
        JSON.stringify({ error: 'Prompt and title are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating video for user:', user.id);
    console.log('Prompt:', prompt);

    // Get user preferences for enhanced prompt
    const { data: preferences } = await supabaseClient
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // Enhance prompt based on user preferences
    let enhancedPrompt = prompt;
    if (preferences?.preferred_style) {
      enhancedPrompt += ` with ${preferences.preferred_style} style`;
    }
    if (preferences?.preferred_duration) {
      enhancedPrompt += `, duration: ${preferences.preferred_duration}`;
    }

    console.log('Enhanced prompt:', enhancedPrompt);

    // Create video record
    const { data: videoRecord, error: insertError } = await supabaseClient
      .from('videos')
      .insert({
        user_id: user.id,
        title: title,
        prompt: prompt,
        status: 'generating'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating video record:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to create video record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Save prompt to chat history
    await supabaseClient
      .from('prompts')
      .insert({
        user_id: user.id,
        content: prompt,
        type: 'user',
        video_id: videoRecord.id
      });

    // Get required environment variables
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID');
    const location = Deno.env.get('GOOGLE_CLOUD_LOCATION') || 'us-central1';
    
    if (!geminiApiKey || !projectId) {
      throw new Error('GEMINI_API_KEY and GOOGLE_CLOUD_PROJECT_ID must be configured');
    }

    console.log('Calling Video Generation API for video ID:', videoRecord.id);
    
    // Call Gemini VEO 3 video generation API
    const veoApiUrl = `https://generativelanguage.googleapis.com/v1beta/projects/${projectId}/locations/${location}/videos:generate`;
    
    const videoResponse = await fetch(veoApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiApiKey,
      },
      body: JSON.stringify({
        generateVideoRequest: {
          prompt: enhancedPrompt,
          model: 'models/veo-3.0-generate-001'
        }
      })
    });

    if (!videoResponse.ok) {
      const errorText = await videoResponse.text();
      console.error('Video Generation API error:', errorText);
      throw new Error(`Video Generation API failed with status ${videoResponse.status}`);
    }

    const videoData = await videoResponse.json();
    const operationName = videoData.name;
    
    if (!operationName) {
      throw new Error('No operation name returned from VEO API');
    }

    console.log(`Video ${videoRecord.id} started processing with operation:`, operationName);

    // Update video record with processing status and operation name
    const { error: updateError } = await supabaseClient
      .from('videos')
      .update({
        status: 'processing',
        operation_name: operationName
      })
      .eq('id', videoRecord.id);

    if (updateError) {
      console.error('Failed to update video record with operation_name:', updateError);
      
      // Mark video as failed if we can't update it with operation name
      await supabaseClient
        .from('videos')
        .update({
          status: 'failed',
          error_message: 'Failed to update video with operation name'
        })
        .eq('id', videoRecord.id);
        
      throw new Error('Failed to update video record with operation name');
    }

    // Save prompt to chat history
    await supabaseClient
      .from('prompts')
      .insert({
        user_id: user.id,
        content: prompt,
        type: 'user',
        video_id: videoRecord.id
      });

    // Save AI response to chat history indicating video is processing
    const aiResponse = 'Video generation started! Your video is now being processed. You will be notified when it\'s ready.';
    await supabaseClient
      .from('prompts')
      .insert({
        user_id: user.id,
        content: aiResponse,
        type: 'assistant',
        video_id: videoRecord.id
      });

    // Update user preferences analytics
    try {
      await supabaseClient
        .from('user_preferences')
        .update({ total_videos: (preferences?.total_videos || 0) + 1 })
        .eq('user_id', user.id);
    } catch (updateError) {
      console.error('Error updating user stats:', updateError);
    }

    // Analyze user preferences (simplified)
    const userPrompts = await supabaseClient
      .from('prompts')
      .select('content')
      .eq('user_id', user.id)
      .eq('type', 'user')
      .limit(10);

    if (userPrompts.data && userPrompts.data.length > 5) {
      // Simple analysis based on common words
      const allPrompts = userPrompts.data.map(p => p.content).join(' ');
      const keywords = allPrompts.toLowerCase().match(/\b\w{4,}\b/g) || [];
      const wordCount = keywords.reduce((acc: any, word: string) => {
        acc[word] = (acc[word] || 0) + 1;
        return acc;
      }, {});
      
      const topKeywords = Object.entries(wordCount)
        .sort(([,a]: any, [,b]: any) => b - a)
        .slice(0, 5)
        .map(([word]) => word);

      const analysisText = `User tends to create videos with themes related to: ${topKeywords.join(', ')}`;
      
      await supabaseClient
        .from('user_preferences')
        .update({
          analysis_summary: analysisText,
          preferred_themes: topKeywords
        })
        .eq('user_id', user.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        video: videoRecord,
        aiResponse: aiResponse
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in generate-video function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});