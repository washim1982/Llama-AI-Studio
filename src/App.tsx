import React, { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  Compass,
  MessageSquareText,
  Server,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import type {
  AppSettings,
  AppState,
  ChatSummary,
  GgufModel,
  RuntimeInfo,
  ServerStatus,
  ViewId,
} from './types';
import { ChatPage } from './pages/ChatPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { ModelsPage } from './pages/ModelsPage';
import { ServerPage } from './pages/ServerPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';
import { getForgeApi } from './utils';

import logoMark from './assets/logo-mark.svg';

const navigation: Array<{
  id: ViewId;
  label: string;
  icon: typeof MessageSquareText;
}> = [
  { id: 'chat', label: 'Chats', icon: MessageSquareText },
  { id: 'models', label: 'My models', icon: Boxes },
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'server', label: 'Developer', icon: Server },
  { id: 'admin', label: 'API admin', icon: ShieldCheck },
];

export default function App() {
  const [state, setState] = useState<AppState>();
  const [activeView, setActiveView] = useState<ViewId>('chat');
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let disposed = false;
    let cleanupFuncs: Array<(() => void) | undefined> = [];

    const init = async (retriesLeft = 10) => {
      const api = getForgeApi();
      if (!api?.getState) {
        if (retriesLeft > 0 && !disposed) {
          setTimeout(() => void init(retriesLeft - 1), 100);
        } else if (!disposed) {
          setError('Electron IPC API not available');
        }
        return;
      }

      try {
        const next = await api.getState();
        if (disposed) return;
        setState(next);
        setSelectedModelId(next.server?.modelId ?? next.models[0]?.id);
        setError(undefined);

        const offStatus = api.onServerStatus?.((server: ServerStatus) => {
          setState((current) => (current ? { ...current, server } : current));
          if (server.modelId) setSelectedModelId(server.modelId);
        });
        const offRuntime = api.onRuntimeProgress?.((runtime: RuntimeInfo) => {
          setState((current) => (current ? { ...current, runtime } : current));
        });
        const offModels = api.onModelsUpdated?.((models?: GgufModel[]) => {
          if (Array.isArray(models)) {
            updateModels(models);
          }
        });
        cleanupFuncs.push(offStatus, offRuntime, offModels);
      } catch (reason: any) {
        if (!disposed) setError(String(reason));
      }
    };

    void init();

    return () => {
      disposed = true;
      cleanupFuncs.forEach((fn) => fn?.());
    };
  }, []);

  const selectedModel = useMemo(
    () => state?.models.find((model) => model.id === selectedModelId),
    [selectedModelId, state?.models],
  );

  const updateModels = (models: GgufModel[]) => {
    setState((current) => (current ? { ...current, models } : current));
    setSelectedModelId((current) =>
      current && models.some((model) => model.id === current) ? current : models[0]?.id,
    );
  };

  const updateChats = (chats: ChatSummary[]) => {
    setState((current) => (current ? { ...current, chats } : current));
  };

  const updateSettings = (settings: AppSettings) => {
    setState((current) => (current ? { ...current, settings } : current));
  };

  const updateRuntime = (runtime: RuntimeInfo) => {
    setState((current) => (current ? { ...current, runtime } : current));
  };

  const updateServer = (server: ServerStatus) => {
    setState((current) => (current ? { ...current, server } : current));
  };

  if (!state) {
    return (
      <div className="app-loading">
        <div>
          <strong style={{ fontSize: '18px', color: 'var(--accent)' }}>Llama AI Studio</strong>
          <span>{error ?? 'Opening your local workspace…'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="titlebar">
        <div className="titlebar-brand">
          <img src={logoMark} className="titlebar-logo" alt="Llama AI Studio" />
          <span>Llama AI Studio</span>
          <span className="version-pill">0.3.6</span>
        </div>
      </div>
      <aside className="navigation-rail">
        <div className="brand-mark">
          <img src={logoMark} alt="Llama AI Studio" />
        </div>
        <nav>
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-button ${activeView === item.id ? 'active' : ''}`}
                key={item.id}
                onClick={() => setActiveView(item.id)}
                title={item.label}
              >
                <Icon size={19} />
              </button>
            );
          })}
        </nav>
        <div className="nav-spacer" />
        <button
          className={`nav-button ${activeView === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveView('settings')}
          title="Settings"
        >
          <Settings size={19} />
        </button>
      </aside>

      <main className="app-main">
        {activeView === 'chat' && (
          <ChatPage
            chats={state.chats}
            models={state.models}
            server={state.server}
            settings={state.settings}
            selectedModelId={selectedModelId}
            onSelectModel={setSelectedModelId}
            onChatsChange={updateChats}
            onModelsChange={updateModels}
            onSettingsChange={updateSettings}
            onOpenModels={() => setActiveView('models')}
            onOpenServer={() => setActiveView('server')}
          />
        )}
        {activeView === 'models' && (
          <ModelsPage
            models={state.models}
            selectedModelId={selectedModelId}
            settings={state.settings}
            server={state.server}
            runtime={state.runtime}
            onSelectModel={setSelectedModelId}
            onModelsChange={updateModels}
            onServerChange={updateServer}
            onOpenChat={() => setActiveView('chat')}
          />
        )}
        {activeView === 'discover' && (
          <DiscoverPage
            settings={state.settings}
            onModelsChange={updateModels}
            onOpenModels={() => setActiveView('models')}
          />
        )}
        {activeView === 'server' && (
          <ServerPage
            server={state.server}
            models={state.models}
            selectedModel={selectedModel}
            settings={state.settings}
            runtime={state.runtime}
            onServerChange={updateServer}
            onSelectModel={setSelectedModelId}
          />
        )}
        {activeView === 'settings' && (
          <SettingsPage
            settings={state.settings}
            runtime={state.runtime}
            onSettingsChange={updateSettings}
            onRuntimeChange={updateRuntime}
            onModelsChange={updateModels}
          />
        )}
        {activeView === 'admin' && <AdminPage settings={state.settings} />}
      </main>
    </div>
  );
}
