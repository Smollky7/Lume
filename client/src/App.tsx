import { ToastProvider } from './components/Toasts';
import HostPage from './pages/HostPage';
import ActivityPage from './pages/ActivityPage';
import WatchPage from './pages/WatchPage';

export default function App() {
  const path = location.pathname.replace(/^\/\.proxy/, '');
  const query = new URLSearchParams(location.search);
  const m = path.match(/^\/r\/([\w-]+)/);
  const activity = path.startsWith('/activity') || query.has('frame_id');
  return (
    <ToastProvider>
      {activity ? <ActivityPage /> : m ? <WatchPage roomId={m[1]} autoJoin={query.get('autojoin') === '1'} /> : <HostPage />}
    </ToastProvider>
  );
}
