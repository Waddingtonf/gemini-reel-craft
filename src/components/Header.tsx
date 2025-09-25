import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/hooks/useAuth';
import { LogOut, Video, User, BarChart3 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface UserStats {
  total_videos: number;
  preferred_style?: string;
  analysis_summary?: string;
}

export default function Header() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [stats, setStats] = useState<UserStats | null>(null);

  useEffect(() => {
    if (user) {
      loadUserStats();
    }
  }, [user]);

  const loadUserStats = async () => {
    try {
      const { data } = await supabase
        .from('user_preferences')
        .select('total_videos, preferred_style, analysis_summary')
        .eq('user_id', user?.id)
        .single();
      
      if (data) {
        setStats(data);
      }
    } catch (error) {
      console.error('Error loading user stats:', error);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      toast({
        title: "Logout realizado",
        description: "Até logo!",
      });
    } catch (error) {
      toast({
        title: "Erro",
        description: "Erro ao fazer logout",
        variant: "destructive",
      });
    }
  };

  const getUserInitials = () => {
    if (!user?.email) return 'U';
    return user.email.substring(0, 2).toUpperCase();
  };

  return (
    <header className="border-b bg-card/50 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Video className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold">GerarVideos AI</h1>
                <p className="text-xs text-muted-foreground">
                  Powered by Gemini VEO 3
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {stats && (
              <div className="hidden md:flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <BarChart3 className="w-4 h-4" />
                  <span>{stats.total_videos} vídeos</span>
                </div>
                {stats.preferred_style && (
                  <div className="text-muted-foreground">
                    Estilo: {stats.preferred_style}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Avatar className="w-8 h-8">
                <AvatarFallback className="text-xs">
                  {getUserInitials()}
                </AvatarFallback>
              </Avatar>
              
              <div className="hidden sm:block">
                <p className="text-sm font-medium">
                  {user?.email?.split('@')[0]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {user?.email}
                </p>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                className="flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}