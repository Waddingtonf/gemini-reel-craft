// supabase/functions/generate-video/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !geminiApiKey) {
      throw new Error('Supabase or Gemini configuration missing');
    }

    // Usar a Service Role Key para operações de escrita no backend
    const supabaseClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Validar o JWT do usuário que fez a requisição
    const { data: { user } } = await createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } }
    }).auth.getUser();
    
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { prompt, title } = await req.json();
    if (!prompt?.trim() || !title?.trim()) {
      return new Response(JSON.stringify({ error: 'Prompt and title are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 1. Criar o registro do vídeo no banco de dados com status 'generating'
    const { data: videoRecord, error: insertError } = await supabaseClient
      .from('videos')
      .insert({
        user_id: user.id,
        title: title.trim(),
        prompt: prompt.trim(),
        status: 'generating', // Status inicial
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating video record:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to create video record' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2. Chamar a API VEO para iniciar a geração do vídeo
    console.log('Calling VEO API to start video generation...');
    
    // ALTERAÇÃO: Endpoint corrigido para a API de geração de vídeo assíncrona (VEO)
    const veoApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-001:predictLongRunning`;
    
    const veoResponse = await fetch(veoApiUrl, {
      method: 'POST',
      headers: {
        'x-goog-api-key': geminiApiKey,
        'Content-Type': 'application/json'
      },
      // ALTERAÇÃO: Body ajustado para o formato esperado pela API VEO
      body: JSON.stringify({
        instances: [{
          prompt: prompt.trim()
        }]
      }),
    });

    if (!veoResponse.ok) {
        const errorText = await veoResponse.text();
        console.error('Video Generation API error:', errorText);
        // Atualiza o registro como falho
        await supabaseClient.from('videos').update({ status: 'failed', error_message: `API Error: ${veoResponse.statusText}` }).eq('id', videoRecord.id);
        throw new Error(`Video Generation API failed with status ${veoResponse.status}`);
    }

    const veoData = await veoResponse.json();
    const operation_name = veoData.name;

    if (!operation_name) {
        console.error('Could not get operation_name from VEO API response:', veoData);
        await supabaseClient.from('videos').update({ status: 'failed', error_message: 'No operation_name in API response' }).eq('id', videoRecord.id);
        throw new Error('No operation_name received from VEO API.');
    }

    console.log(`Video generation started. Operation Name: ${operation_name}`);

    // 3. Atualizar o registro do vídeo com o operation_name e o status 'processing'
    const { error: updateError } = await supabaseClient
      .from('videos')
      .update({
        operation_name: operation_name,
        status: 'processing' // Status para ser monitorado pela outra função
      })
      .eq('id', videoRecord.id);

    if (updateError) {
        console.error('Failed to update video record with operation_name:', updateError);
        // Opcional: tentar reverter ou marcar como falha
        await supabaseClient.from('videos').update({ status: 'failed', error_message: 'Failed to save operation name' }).eq('id', videoRecord.id);
        return new Response(JSON.stringify({ error: 'Failed to update video record', details: updateError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 4. Retornar sucesso, informando que o vídeo está em processamento
    return new Response(JSON.stringify({
      success: true,
      message: 'Video generation started.',
      videoId: videoRecord.id,
      status: 'processing'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Unexpected error in generate-video function:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', message: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});