import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play, Download, Clock, FileVideo } from 'lucide-react';

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

interface VideoCardProps {
  video: Video;
}

export default function VideoCard({ video }: VideoCardProps) {
  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    return `${seconds}s`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'generating':
      case 'processing':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return 'Concluído';
      case 'generating':
        return 'Gerando...';
      case 'processing':
        return 'Processando...';
      case 'failed':
        return 'Falhou';
      default:
        return status;
    }
  };

  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{video.title}</h4>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {video.prompt}
          </p>
        </div>
        <Badge 
          variant="outline" 
          className={`ml-2 text-xs ${getStatusColor(video.status)}`}
        >
          {getStatusText(video.status)}
        </Badge>
      </div>

      {(video.status === 'generating' || video.status === 'processing') && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="animate-spin rounded-full h-3 w-3 border-b border-primary"></div>
          <span>{video.status === 'processing' ? 'Processando vídeo...' : 'Iniciando geração...'}</span>
        </div>
      )}

      {video.status === 'completed' && (
        <>
          <div className="aspect-video bg-muted rounded-md flex items-center justify-center">
            {(video.video_url || video.video_uri) ? (
              <video 
                src={video.video_uri || video.video_url || ''} 
                className="w-full h-full rounded-md object-cover"
                controls
                preload="metadata"
              />
            ) : (
              <div className="text-center">
                <FileVideo className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Vídeo não disponível</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              {video.duration && (
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>{formatDuration(video.duration)}</span>
                </div>
              )}
              {video.file_size && (
                <span>{formatFileSize(video.file_size)}</span>
              )}
            </div>
            <div className="flex gap-1">
              {(video.video_url || video.video_uri) && (
                <>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="h-6 px-2"
                    onClick={() => {
                      const videoElement = document.querySelector(`video[src="${video.video_uri || video.video_url}"]`) as HTMLVideoElement;
                      if (videoElement) {
                        videoElement.play();
                      }
                    }}
                  >
                    <Play className="w-3 h-3" />
                  </Button>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="h-6 px-2"
                    onClick={() => {
                      const url = video.video_uri || video.video_url;
                      if (url) {
                        window.open(url, '_blank');
                      }
                    }}
                  >
                    <Download className="w-3 h-3" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {video.status === 'failed' && (
        <div className="text-center py-4">
          <p className="text-xs text-red-500">Falha na geração do vídeo</p>
          {video.error_message && (
            <p className="text-xs text-red-400 mt-1 break-words">{video.error_message}</p>
          )}
          <Button size="sm" variant="outline" className="mt-2 text-xs">
            Tentar novamente
          </Button>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        {new Date(video.created_at).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}
      </div>
    </Card>
  );
}