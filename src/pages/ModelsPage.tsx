import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  BrainCircuit,
  FolderOpen,
  HardDrive,
  ImagePlus,
  Import,
  MessageSquareText,
  Play,
  RefreshCcw,
  Search,
  Settings2,
  Trash2,
  Unlink,
} from 'lucide-react';
import type {
  AppSettings,
  GgufModel,
  LoadConfig,
  RuntimeInfo,
  ServerStatus,
} from '../types';
import { estimateMemory, totalFreeVram } from '../memoryEstimate';
import { errorMessage, formatBytes } from '../utils';
import { LoadConfigPanel } from '../components/LoadConfigPanel';
import {
  Button,
  EmptyState,
  IconButton,
  Notice,
  StatusPill,
  TextInput,
} from '../components/Controls';

export function ModelsPage({
  models,
  selectedModelId,
  settings,
  server,
  runtime,
  onSelectModel,
  onModelsChange,
  onServerChange,
  onOpenChat,
}: {
  models: GgufModel[];
  selectedModelId?: string;
  settings: AppSettings;
  server: ServerStatus;
  runtime: RuntimeInfo;
  onSelectModel: (id: string) => void;
  onModelsChange: (models: GgufModel[]) => void;
  onServerChange: (status: ServerStatus) => void;
  onOpenChat: () => void;
}) {
  const forgeApi = (window as any).forge || (window as any).forgeApi;
  const [query, setQuery] = useState('');
  const [detailTab, setDetailTab] = useState<'info' | 'load'>('info');
  const [config, setConfig] = useState<LoadConfig>({ ...settings.defaultLoadConfig });
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const selected = models.find((model) => model.id === selectedModelId) ?? models[0];

  const visibleModels = useMemo(
    () =>
      models.filter((model) =>
        `${model.name} ${model.fileName} ${model.architecture} ${model.quantization}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [models, query],
  );

  const chooseFiles = async () => {
    if (!forgeApi?.chooseModelFiles) return;
    setBusy('files');
    setError(undefined);
    try {
      onModelsChange(await forgeApi.chooseModelFiles());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const chooseVisionPair = async () => {
    if (!forgeApi?.chooseVisionModelPair) return;
    setBusy('vision-pair');
    setError(undefined);
    try {
      const existingIds = new Set(models.map((model) => model.id));
      const next: GgufModel[] = await forgeApi.chooseVisionModelPair();
      onModelsChange(next);
      const paired =
        next.find((model) => !existingIds.has(model.id) && model.mmprojPath) ??
        [...next]
          .filter((model) => model.mmprojPath)
          .sort((a, b) => b.importedAt - a.importedAt)[0];
      if (paired) onSelectModel(paired.id);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const chooseProjector = async () => {
    if (!selected || !forgeApi?.chooseModelProjector) return;
    setBusy('projector');
    setError(undefined);
    try {
      onModelsChange(await forgeApi.chooseModelProjector(selected.id));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const clearProjector = async () => {
    if (!selected || !forgeApi?.clearModelProjector) return;
    setBusy('projector');
    setError(undefined);
    try {
      onModelsChange(await forgeApi.clearModelProjector(selected.id));
      setConfig((current) => ({ ...current, mmprojPath: '' }));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const chooseDirectory = async () => {
    if (!forgeApi?.chooseModelDirectory && !forgeApi?.selectModelFolder) return;
    setBusy('directory');
    setError(undefined);
    try {
      const fn = forgeApi.chooseModelDirectory || forgeApi.selectModelFolder;
      onModelsChange(await fn());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const scan = async () => {
    if (!forgeApi?.scanModels) return;
    setBusy('scan');
    try {
      onModelsChange(await forgeApi.scanModels());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const removeFolder = async (folder: string) => {
    if (!forgeApi?.removeModelFolder) return;
    setBusy('folder');
    try {
      onModelsChange(await forgeApi.removeModelFolder(folder));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const load = async () => {
    if (!selected || !forgeApi?.startServer) return;
    if (selected.validationError) {
      setError(selected.validationError);
      return;
    }
    setBusy('load');
    setError(undefined);
    try {
      const status = await forgeApi.startServer(selected.id, {
        ...config,
        mmprojPath: selected.mmprojPath || config.mmprojPath || '',
      });
      onServerChange(status);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="page-container" style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* Sidebar - Library List */}
      <div className="sidebar-panel" style={{ width: '320px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <Button variant="primary" style={{ flex: 1 }} onClick={chooseFiles} loading={busy === 'files'}>
              <Import size={14} /> Import File
            </Button>
            <Button style={{ flex: 1 }} onClick={chooseDirectory} loading={busy === 'directory'}>
              <FolderOpen size={14} /> Add Folder
            </Button>
          </div>
          <Button onClick={chooseVisionPair} loading={busy === 'vision-pair'}>
            <ImagePlus size={14} /> Add Text + Vision Model Pair
          </Button>
          <TextInput
            placeholder="Search local models..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Model Directories Section */}
        {settings.modelDirectories.length > 0 && (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
              Model Search Directories
            </div>
            {settings.modelDirectories.map((f) => (
              <div key={f} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', padding: '2px 0' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>{f}</span>
                <IconButton label="Remove folder" onClick={() => void removeFolder(f)}>
                  <Trash2 size={11} />
                </IconButton>
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {visibleModels.map((m) => (
            <div
              key={m.id}
              onClick={() => onSelectModel(m.id)}
              style={{
                padding: '10px 12px',
                borderRadius: '6px',
                marginBottom: '6px',
                cursor: 'pointer',
                background: selected?.id === m.id ? 'var(--panel-3)' : 'transparent',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-main)', marginBottom: '4px' }}>
                {m.name}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', gap: '8px' }}>
                <span>{m.parameters}</span>
                <span>{m.quantization}</span>
                <span>{formatBytes(m.size)}</span>
                {m.mmprojPath && <span style={{ color: 'var(--accent)' }}>Image ready</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Model Inspector & Configuration */}
      <div className="main-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '24px' }}>
        {error && <Notice kind="danger" onClose={() => setError(undefined)}>{error}</Notice>}

        {selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-main)' }}>{selected.name}</h2>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {selected.path}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="primary" onClick={load} loading={busy === 'load'}>
                  <Play size={15} /> Load Model
                </Button>
                <Button onClick={onOpenChat}>
                  Open Chat
                </Button>
              </div>
            </div>

            {/* Capability Badges */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {selected.mmprojPath ? (
                <span style={{ fontSize: '11px', padding: '2px 8px', background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: '12px' }}>Vision ready</span>
              ) : selected.capabilities.vision ? (
                <span style={{ fontSize: '11px', padding: '2px 8px', background: 'rgba(239, 185, 86, 0.14)', color: 'var(--amber)', borderRadius: '12px' }}>Vision projector required</span>
              ) : (
                <span style={{ fontSize: '11px', padding: '2px 8px', background: 'var(--panel-3)', color: 'var(--text-muted)', borderRadius: '12px' }}>Text only</span>
              )}
              {selected.capabilities.reasoning && <span style={{ fontSize: '11px', padding: '2px 8px', background: 'rgba(16, 185, 129, 0.15)', color: 'var(--green)', borderRadius: '12px' }}>Deep Reasoning</span>}
              {selected.capabilities.tools && <span style={{ fontSize: '11px', padding: '2px 8px', background: 'rgba(59, 130, 246, 0.15)', color: 'var(--blue)', borderRadius: '12px' }}>Tools / Functions</span>}
            </div>

            <div className={`vision-pair-card ${selected.mmprojPath ? 'paired' : ''}`}>
              <div className="vision-pair-icon"><ImagePlus size={19} /></div>
              <div className="vision-pair-copy">
                <strong>{selected.mmprojPath ? 'Text + image input enabled' : 'Add image input support'}</strong>
                <span>
                  {selected.mmprojPath
                    ? `Paired with ${selected.mmprojName ?? fileName(selected.mmprojPath)}`
                    : 'Pair this language GGUF with its matching mmproj.gguf vision projector.'}
                </span>
                {selected.mmprojPath && <code title={selected.mmprojPath}>{selected.mmprojPath}</code>}
              </div>
              {selected.mmprojSize && <span className="vision-pair-size">{formatBytes(selected.mmprojSize)}</span>}
              <Button variant={selected.mmprojPath ? 'secondary' : 'primary'} onClick={chooseProjector} loading={busy === 'projector'}>
                <ImagePlus size={13} /> {selected.mmprojPath ? 'Change projector' : 'Select mmproj'}
              </Button>
              {selected.mmprojPath && (
                <IconButton label="Remove vision projector pairing" onClick={() => void clearProjector()} disabled={busy === 'projector'}>
                  <Unlink size={14} />
                </IconButton>
              )}
            </div>

            {/* Load Config Panel */}
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>Inference Load Settings</h4>
              <LoadConfigPanel
                value={config}
                onChange={setConfig}
                model={selected}
              />
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<HardDrive size={32} />}
            title="No models imported"
            description="Import GGUF files or add a local folder to start model inference."
          />
        )}
      </div>
    </div>
  );
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}
