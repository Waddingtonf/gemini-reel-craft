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
  status: string;
  created_at: string;
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
      
      // Set up real-time subscription for video status updates
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
            console.log('Video updated:', payload);
            // Reload videos when any video is updated
            loadVideos();
            
            // If video is completed, show success toast
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
      };
    }
  }, [user, toast]);

  const loadChatHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('prompts')
        .select('*')
        .eq('user_id', user?.id)
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
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('user_id', user?.id)
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
      const { data, error } = await supabase.functions.invoke('generate-video', {
        body: {
          prompt: input,
          title: title
        }
      });

      if (error) throw error;

      const assistantMessage: Message = {
        id: `temp-assistant-${Date.now()}`,
        content: data.aiResponse || 'Vídeo gerado com sucesso!',
        type: 'assistant',
        video_id: data.video?.id,
        created_at: new Date().toISOString()
      };

      setMessages(prev => [...prev.slice(0, -1), userMessage, assistantMessage]);
      
      toast({
        title: "Vídeo gerado!",
        description: "Seu vídeo foi gerado com sucesso e está disponível na galeria.",
      });

      // Reload data
      loadChatHistory();
      loadVideos();

    } catch (error: any) {
      console.error('Error generating video:', error);
      toast({
        title: "Erro",
        description: error.message || "Falha ao gerar o vídeo. Tente novamente.",
        variant: "destructive",
      });
      setMessages(prev => prev.slice(0, -1));
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
                        {message.video_id && (
                          <div className="mt-2 p-2 bg-muted rounded-md">
                            <p className="text-xs text-muted-foreground mb-1">Vídeo relacionado:</p>
                            <div className="text-xs">
                              ID: {message.video_id}
                              {videos.find(v => v.id === message.video_id) && (
                                <span className="ml-2">
                                  Status: {videos.find(v => v.id === message.video_id)?.status === 'completed' ? '✅ Concluído' : 
                                          videos.find(v => v.id === message.video_id)?.status === 'processing' ? '⏳ Processando' :
                                          videos.find(v => v.id === message.video_id)?.status === 'failed' ? '❌ Falhou' : 
                                          '⏳ Gerando'}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
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
                    handleSubmit(e);
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