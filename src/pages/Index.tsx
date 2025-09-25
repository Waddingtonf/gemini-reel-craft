import { useAuth } from '@/hooks/useAuth';
import AuthPage from '@/components/AuthPage';
import Header from '@/components/Header';
import Chat from '@/components/Chat';

const Index = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto p-4 h-[calc(100vh-80px)]">
        <Chat />
      </main>
    </div>
  );
};

export default Index;
