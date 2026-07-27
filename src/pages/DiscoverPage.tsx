import React, { useEffect, useMemo, useState } from 'react';
import {
  Compass,
  Download,
  ExternalLink,
  FileBox,
  Heart,
  LoaderCircle,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AppSettings,
  DownloadProgress,
  GgufModel,
  HfFile,
  HfModelDetail,
  HfModelSummary,
} from '../types';
import { errorMessage, formatBytes, formatCount } from '../utils';
import {
  Button,
  EmptyState,
  Notice,
  Select,
  StatusPill,
  TextInput,
} from '../components/Controls';

export function DiscoverPage({
  settings,
  onModelsChange,
  onOpenModels,
}: {
  settings: AppSettings;
  onModelsChange: (models: GgufModel[]) => void;
  onOpenModels: () => void;
}) {
  const forgeApi = (window as any).forge || (window as any).forgeApi;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'downloads' | 'updated' | 'likes'>('downloads');
  const [results, setResults] = useState<HfModelSummary[]>([]);
  const [selected, setSelected] = useState<HfModelDetail>();
  const [selectedFile, setSelectedFile] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string>();
  const [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({});

  useEffect(() => {
    if (!forgeApi?.onDownloadProgress) return;
    const off = forgeApi.onDownloadProgress((progress: DownloadProgress) => {
      setDownloads((current) => ({ ...current, [progress.id]: progress }));
      if (progress.state === 'completed' && forgeApi.scanModels) {
        void forgeApi.scanModels().then(onModelsChange);
      }
    });
    void search('');
    return off;
  }, []);

  const search = async (value = query) => {
    if (!forgeApi?.searchHuggingFace) return;
    setLoading(true);
    setError(undefined);
    try {
      const items = await forgeApi.searchHuggingFace(value);
      setResults(items);
      if (items[0] && !selected) void selectModel(items[0].id);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  const selectModel = async (repoId: string) => {
    if (!forgeApi?.getHuggingFaceModel) return;
    setLoadingDetail(true);
    setError(undefined);
    try {
      const detail = await forgeApi.getHuggingFaceModel(repoId);
      setSelected(detail);
      setSelectedFile(
        detail.files.find((file: HfFile) => !file.isMmproj && /Q4_K_M/i.test(file.name))?.name ??
          detail.files.find((file: HfFile) => !file.isMmproj)?.name,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoadingDetail(false);
    }
  };

  const chosenFile = selected?.files.find((file) => file.name === selectedFile);
  const activeDownload = Object.values(downloads).find(
    (download) =>
      download.repoId === selected?.id &&
      download.fileName === selectedFile &&
      (download.state === 'downloading' || download.state === 'verifying'),
  );
  const completedDownload = Object.values(downloads).find(
    (download) =>
      download.repoId === selected?.id &&
      download.fileName === selectedFile &&
      download.state === 'completed',
  );

  const displayedResults = useMemo(() => {
    const next = [...results];
    if (sort === 'likes') return next.sort((a, b) => b.likes - a.likes);
    return next.sort((a, b) => b.downloads - a.downloads);
  }, [results, sort]);

  const startDownload = async () => {
    if (!selected || !selectedFile || !forgeApi?.downloadHuggingFaceFile) return;
    setError(undefined);
    try {
      await forgeApi.downloadHuggingFaceFile(
        selected.id,
        selectedFile,
        chosenFile?.size,
        chosenFile?.sha256,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <div className="page-container" style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* Sidebar - Search & Results */}
      <div className="sidebar-panel" style={{ width: '320px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
            style={{ display: 'flex', gap: '6px' }}
          >
            <TextInput
              placeholder="Search Hugging Face models..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="submit" variant="primary" loading={loading}>
              <Search size={14} />
            </Button>
          </form>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Sort by</span>
            <Select value={sort} onChange={(e) => setSort(e.target.value as any)} style={{ width: '130px' }}>
              <option value="downloads">Downloads</option>
              <option value="likes">Likes</option>
            </Select>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {displayedResults.map((item) => (
            <div
              key={item.id}
              onClick={() => void selectModel(item.id)}
              style={{
                padding: '10px 12px',
                borderRadius: '6px',
                marginBottom: '6px',
                cursor: 'pointer',
                background: selected?.id === item.id ? 'var(--panel-3)' : 'var(--panel-2)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-main)', marginBottom: '4px' }}>
                {item.name}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', gap: '12px' }}>
                <span><Download size={11} /> {formatCount(item.downloads)}</span>
                <span><Heart size={11} /> {formatCount(item.likes)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Detail View */}
      <div className="main-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '24px' }}>
        {error && <Notice kind="danger" onClose={() => setError(undefined)}>{error}</Notice>}

        {loadingDetail && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
            <LoaderCircle className="spin" size={18} /> Loading model repository metadata...
          </div>
        )}

        {selected && !loadingDetail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-main)' }}>{selected.name}</h2>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  by {selected.author} · {formatCount(selected.downloads)} downloads · {formatCount(selected.likes)} likes
                </div>
              </div>
              {forgeApi?.openExternal && (
                <Button onClick={() => forgeApi.openExternal(`https://huggingface.co/${selected.id}`)}>
                  <ExternalLink size={14} /> Open HF
                </Button>
              )}
            </div>

            {/* File Selection & Download Card */}
            <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h4 style={{ fontSize: '13px', fontWeight: 600 }}>Select GGUF Quantization File</h4>
              <Select value={selectedFile || ''} onChange={(e) => setSelectedFile(e.target.value)}>
                {selected.files.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name} ({formatBytes(f.size)}) [{f.quantization}]
                  </option>
                ))}
              </Select>

              {activeDownload && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span>Downloading... {activeDownload.percent.toFixed(1)}%</span>
                    <span>{formatBytes(activeDownload.received)} / {formatBytes(activeDownload.total)}</span>
                  </div>
                  <div style={{ height: '6px', background: 'var(--line)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'var(--accent)', width: `${activeDownload.percent}%` }} />
                  </div>
                  <Button variant="danger" onClick={() => forgeApi?.cancelDownload(activeDownload.id)}>
                    Cancel Download
                  </Button>
                </div>
              )}

              {completedDownload && (
                <Notice kind="success">
                  Download completed and verified!
                  <Button style={{ marginLeft: '12px' }} onClick={onOpenModels}>
                    View in Models
                  </Button>
                </Notice>
              )}

              {!activeDownload && !completedDownload && (
                <Button variant="primary" onClick={startDownload} disabled={!selectedFile}>
                  <Download size={15} /> Download Model File
                </Button>
              )}
            </div>

            {/* Readme Card */}
            {selected.readme && (
              <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
                <h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Model Card / README</h4>
                <div style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text-main)' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selected.readme}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
