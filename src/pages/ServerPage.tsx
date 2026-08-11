import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  CircleStop,
  Code2,
  Copy,
  ExternalLink,
  Globe2,
  MemoryStick,
  Play,
  Server,
  Terminal,
  Trash2,
} from 'lucide-react';
import type {
  AppSettings,
  GgufModel,
  LoadConfig,
  RuntimeInfo,
  ServerStatus,
} from '../types';
import { copyText, errorMessage, formatBytes } from '../utils';
import { LoadConfigPanel } from '../components/LoadConfigPanel';
import {
  developerTopicGroups,
  findDeveloperTopic,
  type DeveloperTopic,
  type DeveloperTopicId,
} from '../developerReference';
import {
  Button,
  IconButton,
  Notice,
  Select,
  StatusPill,
} from '../components/Controls';

export function ServerPage({
  server,
  models,
  selectedModel,
  settings,
  runtime,
  onServerChange,
  onSelectModel,
}: {
  server: ServerStatus;
  models: GgufModel[];
  selectedModel?: GgufModel;
  settings: AppSettings;
  runtime: RuntimeInfo;
  onServerChange: (server: ServerStatus) => void;
  onSelectModel: (id: string) => void;
}) {
  const forgeApi = (window as any).forge || (window as any).forgeApi;
  const [config, setConfig] = useState<LoadConfig>({ ...settings.defaultLoadConfig });
  const [logs, setLogs] = useState<string[]>([]);
  const [gatewayUrl, setGatewayUrl] = useState<string>();
  const [selectedTopicId, setSelectedTopicId] = useState<DeveloperTopicId>('authentication');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState<string>();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!forgeApi?.getServerLogs) return;
    void forgeApi.getServerLogs().then(setLogs);
    if (!forgeApi?.onServerLog) return;
    const off = forgeApi.onServerLog((line: string) => {
      setLogs((current) => [...current.slice(-2998), line]);
      requestAnimationFrame(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      });
    });
    return off;
  }, []);

  useEffect(() => {
    if (!forgeApi?.getAdminDashboard) return;
    void forgeApi.getAdminDashboard().then((dashboard: any) => setGatewayUrl(dashboard.gateway.url));
    return forgeApi.onAdminUpdated?.((dashboard: any) => setGatewayUrl(dashboard.gateway.url));
  }, []);

  const start = async () => {
    if (!selectedModel || !forgeApi?.startServer) return;
    if (selectedModel.validationError) {
      setError(selectedModel.validationError);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onServerChange(
        await forgeApi.startServer(selectedModel.id, {
          ...config,
          mmprojPath: config.mmprojPath || selectedModel.mmprojPath || '',
        }),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!forgeApi?.stopServer) return;
    setBusy(true);
    try {
      onServerChange(await forgeApi.stopServer());
    } finally {
      setBusy(false);
    }
  };

  const releaseMemory = async () => {
    if (!forgeApi?.releaseServerMemory) return;
    setBusy(true);
    setError(undefined);
    try {
      onServerChange(await forgeApi.releaseServerMemory());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (key: string, text: string) => {
    await copyText(text);
    setCopied(key);
    setTimeout(() => setCopied(undefined), 2000);
  };

  const topic = findDeveloperTopic(selectedTopicId);
  const clientBaseUrl = gatewayUrl ?? server.url;

  return (
    <div className="page-container" style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* Sidebar - Topics */}
      <div className="sidebar-panel" style={{ width: '280px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BookOpen size={16} /> Developer OpenAPI Ref
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 8px' }}>
          {developerTopicGroups.map((group) => (
            <div key={group.label} style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', padding: '0 8px', marginBottom: '4px' }}>
                {group.label}
              </div>
              {group.topics.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTopicId(t.id)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '12.5px',
                    cursor: 'pointer',
                    background: selectedTopicId === t.id ? 'var(--panel-3)' : 'transparent',
                    color: selectedTopicId === t.id ? 'var(--text-main)' : 'var(--text-muted)',
                    marginBottom: '2px',
                  }}
                >
                  {t.title}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Main Server Dashboard & OpenAPI Playground */}
      <div className="main-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '24px' }}>
        {error && <Notice kind="danger" onClose={() => setError(undefined)}>{error}</Notice>}

        {/* Server Status Header */}
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <StatusPill status={server.state === 'running' ? 'running' : 'stopped'}>
                {server.state}
              </StatusPill>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>{server.url}</span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Mode: {server.mode || 'pinned'} · Model: {server.modelName || selectedModel?.name || 'None'}
            </div>
            {gatewayUrl && <div style={{ fontSize: '10px', color: 'var(--blue)', marginTop: '4px' }}>Authenticated client gateway: {gatewayUrl}</div>}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {server.state === 'running' ? (
              <>
                <Button variant="secondary" onClick={releaseMemory} loading={busy}>
                  <MemoryStick size={14} /> Release Memory
                </Button>
                <Button variant="danger" onClick={stop} loading={busy}>
                  <CircleStop size={14} /> Stop Server
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={start} loading={busy}>
                <Play size={14} /> Start Server
              </Button>
            )}
          </div>
        </div>

        {/* OpenAPI Topic Reference */}
        {topic && (
          <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '20px', marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700 }}>{topic.title}</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{topic.summary}</p>

            <div>
              <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '6px' }}>Endpoints</div>
              {topic.endpoints.map((ep, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '4px 0' }}>
                  <span style={{ color: ep.method === 'POST' ? 'var(--blue)' : 'var(--green)', fontWeight: 600 }}>{ep.method}</span>
                  <span style={{ color: 'var(--text-main)' }}>{ep.path}</span>
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>— {ep.description}</span>
                </div>
              ))}
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontWeight: 600, fontSize: '12px' }}>{topic.requestLabel}</span>
                <Button onClick={() => handleCopy('req', topic.request.replace('{{BASE_URL}}', clientBaseUrl))}>
                  <Copy size={12} /> {copied === 'req' ? 'Copied' : 'Copy curl'}
                </Button>
              </div>
              <pre style={{ background: 'var(--console)', padding: '12px', borderRadius: '6px', fontSize: '12px', overflowX: 'auto', border: '1px solid var(--border)' }}>
                {topic.request.replace('{{BASE_URL}}', clientBaseUrl)}
              </pre>
            </div>

            <div>
              <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '6px' }}>{topic.responseLabel}</div>
              <pre style={{ background: 'var(--console)', padding: '12px', borderRadius: '6px', fontSize: '12px', overflowX: 'auto', border: '1px solid var(--border)' }}>
                {topic.response}
              </pre>
            </div>
          </div>
        )}

        {/* Real-time Stdout / Stderr Log Console */}
        <div style={{ background: 'var(--console)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: '260px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Terminal size={14} /> Server Console Logs ({logs.length} lines)
            </span>
            <Button onClick={() => setLogs([])}>
              <Trash2 size={12} /> Clear Logs
            </Button>
          </div>
          <div ref={logRef} style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: '1.5', color: '#a1a1aa' }}>
            {logs.map((l, index) => (
              <div key={index} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {l}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
