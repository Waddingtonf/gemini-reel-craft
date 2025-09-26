import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};
serve(async (req)=>{
  console.log('=== INÍCIO DA FUNÇÃO GENERATE-VIDEO ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    // Verificar variáveis de ambiente críticas
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID');
    console.log('Environment check:');
    console.log('- SUPABASE_URL:', !!supabaseUrl);
    console.log('- SUPABASE_ANON_KEY:', !!supabaseAnonKey);
    console.log('- GEMINI_API_KEY:', !!geminiApiKey);
    console.log('- GOOGLE_CLOUD_PROJECT_ID:', !!projectId);
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase environment variables not configured');
    }
    if (!geminiApiKey || !projectId) {
      throw new Error('GEMINI_API_KEY and GOOGLE_CLOUD_PROJECT_ID must be configured');
    }
    // Criar cliente Supabase
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: req.headers.get('Authorization')
        }
      }
    });
    console.log('Supabase client created');
    // Verificar autenticação
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.log('Missing Authorization header');
      return new Response(JSON.stringify({
        error: 'Missing Authorization header'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Get user from session
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError) {
      console.error('User error:', userError);
      return new Response(JSON.stringify({
        error: 'Authentication error',
        details: userError.message
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!user) {
      console.log('No user found');
      return new Response(JSON.stringify({
        error: 'User not found'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('User authenticated:', user.id);
    // Parse request body
    let requestBody;
    try {
      requestBody = await req.json();
      console.log('Request body parsed:', JSON.stringify(requestBody, null, 2));
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return new Response(JSON.stringify({
        error: 'Invalid JSON in request body'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const { prompt, title } = requestBody;
    if (!prompt || !title) {
      console.log('Missing required fields - prompt:', !!prompt, 'title:', !!title);
      return new Response(JSON.stringify({
        error: 'Prompt and title are required',
        received: {
          prompt: !!prompt,
          title: !!title
        }
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Generating video for user:', user.id);
    console.log('Prompt:', prompt);
    console.log('Title:', title);
    // Get user preferences (com tratamento de erro)
    let preferences = null;
    try {
      const { data: prefData, error: prefError } = await supabaseClient.from('user_preferences').select('*').eq('user_id', user.id).single();
      if (prefError && prefError.code !== 'PGRST116') {
        console.error('Error fetching preferences:', prefError);
      } else {
        preferences = prefData;
        console.log('User preferences loaded:', !!preferences);
      }
    } catch (prefErr) {
      console.error('Exception fetching preferences:', prefErr);
    }
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
    console.log('Creating video record...');
    const { data: videoRecord, error: insertError } = await supabaseClient.from('videos').insert({
      user_id: user.id,
      title: title,
      prompt: prompt,
      status: 'generating'
    }).select().single();
    if (insertError) {
      console.error('Error creating video record:', insertError);
      return new Response(JSON.stringify({
        error: 'Failed to create video record',
        details: insertError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Video record created:', videoRecord.id);
    // Save initial prompt to chat history
    try {
      await supabaseClient.from('prompts').insert({
        user_id: user.id,
        content: prompt,
        type: 'user',
        video_id: videoRecord.id
      });
      console.log('Initial prompt saved to history');
    } catch (promptError) {
      console.error('Error saving prompt to history:', promptError);
    // Don't fail the entire request for this
    }
    // Call Gemini VEO 3 video generation API
    const location = Deno.env.get('GOOGLE_CLOUD_LOCATION') || 'us-central1';
    const veoApiUrl = `https://generativelanguage.googleapis.com/v1beta/projects/${projectId}/locations/${location}/videos:generate`;
    console.log('Calling Video Generation API...');
    console.log('API URL:', veoApiUrl);
    const videoResponse = await fetch(veoApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiApiKey
      },
      body: JSON.stringify({
        generateVideoRequest: {
          prompt: enhancedPrompt,
          model: 'models/veo-3.0-generate-001'
        }
      })
    });
    console.log('Video API response status:', videoResponse.status);
    if (!videoResponse.ok) {
      const errorText = await videoResponse.text();
      console.error('Video Generation API error:', errorText);
      // Update video status to failed
      await supabaseClient.from('videos').update({
        status: 'failed',
        error_message: `API Error: ${videoResponse.status} - ${errorText}`
      }).eq('id', videoRecord.id);
      throw new Error(`Video Generation API failed with status ${videoResponse.status}: ${errorText}`);
    }
    const videoData = await videoResponse.json();
    console.log('Video API response:', JSON.stringify(videoData, null, 2));
    const operationName = videoData.name;
    if (!operationName) {
      console.error('No operation name in response:', videoData);
      throw new Error('No operation name returned from VEO API');
    }
    console.log(`Video ${videoRecord.id} started processing with operation:`, operationName);
    // Update video record with processing status and operation name
    const { error: updateError } = await supabaseClient.from('videos').update({
      status: 'processing',
      operation_name: operationName
    }).eq('id', videoRecord.id);
    if (updateError) {
      console.error('Failed to update video record with operation_name:', updateError);
      // Mark video as failed if we can't update it with operation name
      await supabaseClient.from('videos').update({
        status: 'failed',
        error_message: 'Failed to update video with operation name'
      }).eq('id', videoRecord.id);
      throw new Error('Failed to update video record with operation name');
    }
    console.log('Video record updated with operation name');
    // Save AI response to chat history
    const aiResponse = 'Video generation started! Your video is now being processed. You will be notified when it\'s ready.';
    try {
      await supabaseClient.from('prompts').insert({
        user_id: user.id,
        content: aiResponse,
        type: 'assistant',
        video_id: videoRecord.id
      });
      console.log('AI response saved to history');
    } catch (promptError) {
      console.error('Error saving AI response to history:', promptError);
    }
    // Update user preferences analytics (with error handling)
    try {
      if (preferences) {
        await supabaseClient.from('user_preferences').update({
          total_videos: (preferences.total_videos || 0) + 1
        }).eq('user_id', user.id);
        console.log('User stats updated');
      }
    } catch (updateError) {
      console.error('Error updating user stats:', updateError);
    }
    // Analyze user preferences (simplified) - with error handling
    try {
      const { data: userPrompts } = await supabaseClient.from('prompts').select('content').eq('user_id', user.id).eq('type', 'user').limit(10);
      if (userPrompts && userPrompts.length > 5) {
        // Simple analysis based on common words
        const allPrompts = userPrompts.map((p)=>p.content).join(' ');
        const keywords = allPrompts.toLowerCase().match(/\b\w{4,}\b/g) || [];
        const wordCount = keywords.reduce((acc, word)=>{
          acc[word] = (acc[word] || 0) + 1;
          return acc;
        }, {});
        const topKeywords = Object.entries(wordCount).sort(([, a], [, b])=>b - a).slice(0, 5).map(([word])=>word);
        const analysisText = `User tends to create videos with themes related to: ${topKeywords.join(', ')}`;
        await supabaseClient.from('user_preferences').update({
          analysis_summary: analysisText,
          preferred_themes: topKeywords
        }).eq('user_id', user.id);
        console.log('User analysis updated');
      }
    } catch (analysisError) {
      console.error('Error in user analysis:', analysisError);
    }
    console.log('=== FUNÇÃO CONCLUÍDA COM SUCESSO ===');
    return new Response(JSON.stringify({
      success: true,
      video: videoRecord,
      aiResponse: aiResponse
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('=== ERRO NA FUNÇÃO ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : 'No stack trace available'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
