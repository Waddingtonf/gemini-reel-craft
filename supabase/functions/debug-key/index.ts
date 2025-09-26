// supabase/functions/debug-key/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "O segredo GEMINI_API_KEY não foi encontrado." }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // POR SEGURANÇA, NUNCA RETORNE A CHAVE COMPLETA!
    // Mostramos apenas o início e o fim para podermos identificá-la.
    const partialKey = `${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 5)}`;

    return new Response(
      JSON.stringify({ 
        message: "A função no servidor está lendo esta chave:",
        partial_key: partialKey 
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});