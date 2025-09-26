import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Send, Video, Bot, User } from 'lucide-react';
import VideoCard from './VideoCard';

interface Message {
  id: string;
  content: string;
  type: 'user' | 'assistant';
  video_id?: string;
  created_at: string;
}

interface Video {
  id: string;
  title: string;
  prompt: string;
  video_url: string | null;
  video_uri: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  duration?: number;
  file_size?: number;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [input, setInput] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const { user } = useAuth();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (user) {
      loadChatHistory();
      loadVideos();
      
      const channel = supabase
        .channel('video-updates')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'videos',
            filter: `user_id=eq.${user.id}`
          },
          (payload) => {
            console.log('Video updated via Realtime:', payload);
            setVideos(currentVideos =>
              currentVideos.map(v => v.id === payload.new.id ? { ...v, ...payload.new } : v)
            );
            
            if (payload.new.status === 'completed') {
              toast({
                title: "Vídeo concluído!",
                description: `O vídeo "${payload.new.title}" foi gerado com sucesso!`,
              });
            } else if (payload.new.status === 'failed') {
              toast({
                title: "Falha na geração",
                description: `Erro ao gerar o vídeo "${payload.new.title}". ${payload.new.error_message || 'Tente novamente.'}`,
                variant: "destructive",
              });
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
        }
      };
    }
  }, [user, toast]);
  
  // NOVO: Hook para controlar o polling de status
  useEffect(() => {
    const isProcessing = videos.some(v => v.status === 'processing');

    const startPolling = () => {
      // Inicia o polling apenas se não houver um em andamento
      if (!pollingIntervalRef.current) {
        pollingIntervalRef.current = setInterval(async () => {
          console.log('Polling for video status...');
          try {
            await supabase.functions.invoke('poll-video-status');
          } catch (error) {
            console.error("Polling failed:", error);
          }
        }, 15000); // Roda a cada 15 segundos
      }
    };

    const stopPolling = () => {
      if (pollingIntervalRef.current) {
        console.log('Stopping polling.');
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };

    if (isProcessing) {
      startPolling();
    } else {
      stopPolling();
    }

    return () => stopPolling(); // Limpa o intervalo ao desmontar o componente
  }, [videos]);


  const loadChatHistory = async () => {
    try {
      if (!user) return;
      const { data, error } = await supabase
        .from('prompts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(50);

      if (error) throw error;
      const typedMessages = (data || []).map(msg => ({
        ...msg,
        type: msg.type as 'user' | 'assistant'
      }));
      setMessages(typedMessages);
    } catch (error) {
      console.error('Error loading chat history:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadVideos = async () => {
    try {
        if (!user) return;
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setVideos(data || []);
    } catch (error) {
      console.error('Error loading videos:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !title.trim() || loading) return;

    setLoading(true);
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      content: input,
      type: 'user',
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      // ALTERAÇÃO: A resposta da função apenas inicia o processo
      const { data, error } = await supabase.functions.invoke('generate-video', {
        body: {
          prompt: input,
          title: title
        }
      });

      if (error) throw error;
      
      // ALTERAÇÃO: Mensagem do assistente confirma o início do processo
      const assistantMessage: Message = {
        id: `temp-assistant-${Date.now()}`,
        content: `Certo! Iniciando a geração do vídeo com o título "${title}". Avisarei quando estiver pronto.`,
        type: 'assistant',
        video_id: data.videoId,
        created_at: new Date().toISOString()
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      
      toast({
        title: "Processo iniciado!",
        description: "Seu vídeo está sendo gerado. Você pode acompanhar o status na galeria.",
      });

      // Recarrega os vídeos para mostrar o novo item com status "processing"
      loadVideos();

    } catch (error: any) {
      console.error('Error starting video generation:', error);
      toast({
        title: "Erro ao iniciar",
        description: error.message || "Não foi possível iniciar a geração do vídeo.",
        variant: "destructive",
      });
      // Remove a mensagem de usuário que falhou
      setMessages(prev => prev.filter(m => m.id !== userMessage.id));
    } finally {
      setInput('');
      setTitle('');
      setLoading(false);
    }
  };

  if (loadingHistory) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex gap-6">
        {/* Chat Area */}
        <Card className="flex-1 flex flex-col">
          <div className="p-4 border-b">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Bot className="w-5 h-5" />
              AI Video Generator
            </h2>
          </div>
          
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {messages.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <Video className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Comece uma conversa para gerar seus primeiros vídeos!</p>
                </div>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${
                      message.type === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`flex gap-3 max-w-[80%] ${
                        message.type === 'user' ? 'flex-row-reverse' : 'flex-row'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        message.type === 'user' 
                          ? 'bg-primary text-primary-foreground' 
                          : 'bg-secondary text-secondary-foreground'
                      }`}>
                        {message.type === 'user' ? (
                          <User className="w-4 h-4" />
                        ) : (
                          <Bot className="w-4 h-4" />
                        )}
                      </div>
                      <div
                        className={`rounded-lg p-3 ${
                          message.type === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary text-secondary-foreground'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          <form onSubmit={handleSubmit} className="p-4 border-t space-y-3">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título do vídeo..."
              disabled={loading}
              className="w-full"
            />
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Descreva o vídeo que você quer gerar..."
                disabled={loading}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e as any);
                  }
                }}
              />
              <Button type="submit" disabled={loading || !input.trim() || !title.trim()}>
                {loading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </form>
        </Card>

        {/* Videos Gallery */}
        <div className="w-80">
          <Card className="h-full">
            <div className="p-4 border-b">
              <h3 className="font-semibold flex items-center gap-2">
                <Video className="w-4 h-4" />
                Meus Vídeos ({videos.length})
              </h3>
            </div>
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3">
                {videos.map((video) => (
                  <VideoCard key={video.id} video={video} />
                ))}
                {videos.length === 0 && (
                  <div className="text-center text-muted-foreground py-8">
                    <Video className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Nenhum vídeo ainda</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </Card>
        </div>
      </div>
    </div>
  );
}