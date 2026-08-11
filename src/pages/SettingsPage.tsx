import React, { useMemo, useState } from 'react';
import {
  Cpu,
  Download,
  FolderOpen,
  HardDrive,
  KeyRound,
  RefreshCcw,
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  AppSettings,
  GgufModel,
  LlamaFlag,
  RuntimeFlavor,
  RuntimeInfo,
} from '../types';
import { errorMessage } from '../utils';
import { LoadConfigPanel } from '../components/LoadConfigPanel';
import { SamplingPanel } from '../components/SamplingPanel';
import {
  Button,
  Field,
  IconButton,
  Notice,
  Select,
  StatusPill,
  TextInput,
  Toggle,
} from '../components/Controls';

type SettingsSection = 'runtime' | 'models' | 'defaults' | 'application';

export function SettingsPage({
  settings,
  runtime,
  onSettingsChange,
  onRuntimeChange,
  onModelsChange,
}: {
  settings: AppSettings;
  runtime: RuntimeInfo;
  onSettingsChange: (settings: AppSettings) => void;
  onRuntimeChange: (runtime: RuntimeInfo) => void;
  onModelsChange: (models: GgufModel[]) => void;
}) {
  const forgeApi = (window as any).forge || (window as any).forgeApi;
  const [draft, setDraft] = useState<AppSettings>(structuredClone(settings));
  const [section, setSection] = useState<SettingsSection>('runtime');
  const [installFlavor, setInstallFlavor] = useState<RuntimeFlavor>('vulkan');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (!forgeApi?.saveSettings) return;
    setBusy('save');
    setError(undefined);
    try {
      const next = await forgeApi.saveSettings(draft);
      onSettingsChange(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const chooseRuntime = async () => {
    if (!forgeApi?.chooseRuntime) return;
    setBusy('runtime');
    try {
      const next = await forgeApi.chooseRuntime();
      onRuntimeChange(next);
      if (next.executablePath) {
        setDraft((current) => ({ ...current, runtimePath: next.executablePath }));
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const installRuntime = async () => {
    if (!forgeApi?.installRuntime) return;
    setBusy('install');
    setError(undefined);
    try {
      await forgeApi.installRuntime(installFlavor);
      const state = await forgeApi.getState();
      onRuntimeChange(state.runtime);
      onSettingsChange(state.settings);
      setDraft(state.settings);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const addModelDirectory = async () => {
    if (!forgeApi?.chooseModelDirectory && !forgeApi?.selectModelFolder) return;
    setBusy('models');
    try {
      const fn = forgeApi.chooseModelDirectory || forgeApi.selectModelFolder;
      const models = await fn();
      const state = await forgeApi.getState();
      setDraft(state.settings);
      onSettingsChange(state.settings);
      onModelsChange(models);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const removeFolder = async (folder: string) => {
    if (!forgeApi?.removeModelFolder) return;
    setBusy('models');
    try {
      const models = await forgeApi.removeModelFolder(folder);
      const state = await forgeApi.getState();
      setDraft(state.settings);
      onSettingsChange(state.settings);
      onModelsChange(models);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="page-container" style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* Settings Navigation Sidebar */}
      <div className="sidebar-panel" style={{ width: '240px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: '12px 8px' }}>
        {[
          ['runtime', 'llama.cpp Runtime', Cpu],
          ['models', 'Model Directories', HardDrive],
          ['defaults', 'Default Presets', Settings],
          ['application', 'Application & Keys', KeyRound],
        ].map(([key, label, Icon]: any) => (
          <div
            key={key}
            onClick={() => setSection(key)}
            style={{
              padding: '10px 12px',
              borderRadius: '6px',
              marginBottom: '4px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: section === key ? 'var(--panel-3)' : 'transparent',
              color: section === key ? 'var(--text-main)' : 'var(--text-muted)',
            }}
          >
            <Icon size={16} /> {label}
          </div>
        ))}
      </div>

      {/* Settings Content Area */}
      <div className="main-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700 }}>Studio Settings</h2>
          <Button variant="primary" onClick={save} loading={busy === 'save'}>
            <Save size={15} /> {saved ? 'Saved!' : 'Save Settings'}
          </Button>
        </div>

        {error && <Notice kind="danger" onClose={() => setError(undefined)}>{error}</Notice>}

        {section === 'runtime' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>llama-server Executable Path</h4>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <TextInput
                  value={draft.runtimePath}
                  onChange={(e) => setDraft({ ...draft, runtimePath: e.target.value })}
                  placeholder="Select llama-server.exe path..."
                />
                <Button onClick={chooseRuntime} loading={busy === 'runtime'}>
                  Browse
                </Button>
              </div>
              <StatusPill status={runtime.exists ? 'running' : 'stopped'}>
                {runtime.exists ? `Executable Available (${runtime.version || 'Ready'})` : 'Not Found'}
              </StatusPill>
            </div>

            <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Auto-Install Prebuilt Runtime</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                Download official GitHub release builds of llama.cpp pre-configured for your GPU acceleration backend.
              </p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Select value={installFlavor} onChange={(e) => setInstallFlavor(e.target.value as any)} style={{ width: '200px' }}>
                  <option value="vulkan">Vulkan (AMD / Nvidia / Intel)</option>
                  <option value="cuda-12">CUDA 12 (Nvidia GPU)</option>
                  <option value="cuda-13">CUDA 13 (Nvidia RTX 50-series)</option>
                  <option value="cpu">CPU Only (AVX2 / AVX512)</option>
                </Select>
                <Button variant="primary" onClick={installRuntime} loading={busy === 'install'}>
                  <Download size={14} /> Install Latest Release
                </Button>
              </div>
            </div>
          </div>
        )}

        {section === 'models' && (
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h4 style={{ fontSize: '14px', fontWeight: 600 }}>Model Search Directories</h4>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Folders configured here will be scanned recursively for GGUF model files.
                </p>
              </div>
              <Button variant="primary" onClick={addModelDirectory} loading={busy === 'models'}>
                <FolderOpen size={14} /> Add Search Directory
              </Button>
            </div>

            {draft.modelDirectories.map((folder) => (
              <div key={folder} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--panel-2)', borderRadius: '6px', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{folder}</span>
                <IconButton label="Remove folder" onClick={() => void removeFolder(folder)}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))}
          </div>
        )}

        {section === 'defaults' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>Default Model Load Settings</h4>
              <LoadConfigPanel
                value={draft.defaultLoadConfig}
                onChange={(next) => setDraft({ ...draft, defaultLoadConfig: next })}
              />
            </div>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>Default Chat Sampling Parameters</h4>
              <SamplingPanel
                value={draft.defaultSampling}
                onChange={(next) => setDraft({ ...draft, defaultSampling: next })}
              />
            </div>
          </div>
        )}

        {section === 'application' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 600 }}>Authenticated API Gateway</h4>
              <Field label="Enable API gateway" description="Issue per-user credentials and meter all proxied inference calls" inline>
                <Toggle
                  label="Enable API gateway"
                  checked={draft.apiGateway.enabled}
                  onChange={(enabled) => setDraft({ ...draft, apiGateway: { ...draft.apiGateway, enabled } })}
                />
              </Field>
              <Field label="Network binding" description="Use localhost by default. Choose All interfaces only for a trusted LAN.">
                <Select value={draft.apiGateway.host} onChange={(event) => setDraft({ ...draft, apiGateway: { ...draft.apiGateway, host: event.target.value } })}>
                  <option value="127.0.0.1">Localhost only (127.0.0.1)</option>
                  <option value="0.0.0.0">All network interfaces (0.0.0.0)</option>
                </Select>
              </Field>
              <Field label="Gateway port" description="Clients use this port instead of the private llama-server port.">
                <TextInput type="number" min="1" max="65535" value={draft.apiGateway.port} onChange={(event) => setDraft({ ...draft, apiGateway: { ...draft.apiGateway, port: Number(event.target.value) } })} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <Field label="Default input price / 1M" description="USD rate prefilled when issuing a key">
                  <TextInput type="number" min="0" step="0.0001" value={draft.apiGateway.defaultInputCostPerMillion} onChange={(event) => setDraft({ ...draft, apiGateway: { ...draft.apiGateway, defaultInputCostPerMillion: Number(event.target.value) } })} />
                </Field>
                <Field label="Default output price / 1M" description="USD rate prefilled when issuing a key">
                  <TextInput type="number" min="0" step="0.0001" value={draft.apiGateway.defaultOutputCostPerMillion} onChange={(event) => setDraft({ ...draft, apiGateway: { ...draft.apiGateway, defaultOutputCostPerMillion: Number(event.target.value) } })} />
                </Field>
              </div>
            </div>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <Field label="Hugging Face API Token" description="Encrypted safely via Windows safeStorage / DPAPI for private GGUF repositories">
                <TextInput
                  type="password"
                  value={draft.huggingFaceToken}
                  onChange={(e) => setDraft({ ...draft, huggingFaceToken: e.target.value })}
                  placeholder="hf_..."
                />
              </Field>
              <Field label="Start server automatically on app launch" inline>
                <Toggle
                  label="Auto-start server"
                  checked={draft.startServerOnLaunch}
                  onChange={(next) => setDraft({ ...draft, startServerOnLaunch: next })}
                />
              </Field>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
