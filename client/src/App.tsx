import { ToastProvider } from './components/Toasts';
import HostPage from './pages/HostPage';
import ActivityPage from './pages/ActivityPage';
import WatchPage from './pages/WatchPage';

export default function App() {
  const m = location.pathname.match(/^\/r\/([\w-]+)/);
  return <ToastProvider>{(location.pathname.startsWith('/activity') || new URLSearchParams(location.search).has('frame_id')) ? <ActivityPage /> : m ? <WatchPage roomId={m[1]} /> : <HostPage />}</ToastProvider>;
}
