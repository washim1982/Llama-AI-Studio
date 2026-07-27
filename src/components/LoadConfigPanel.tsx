import React, { useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit,
  Cpu,
  Database,
  Gauge,
  Globe2,
  Image,
  Layers3,
  Network,
  SlidersHorizontal,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { GgufModel, LoadConfig, RuntimeResources } from '../types';
import { estimateMemory, totalFreeVram } from '../memoryEstimate';
import { formatBytes } from '../utils';
import {
  Button,
  Field,
  Section,
  Select,
  TextArea,
  TextInput,
  Toggle,
} from './Controls';

export function LoadConfigPanel({
  value,
  onChange,
  model,
  compact = false,
}: {
  value: LoadConfig;
  onChange: (value: LoadConfig) => void;
  model?: GgufModel;
  compact?: boolean;
}) {
  const [resources, setResources] = useState<RuntimeResources>();
  const [templateLoading, setTemplateLoading] = useState(false);
  const [embeddedTemplate, setEmbeddedTemplate] = useState<string>();

  useEffect(() => {
    setEmbeddedTemplate(undefined);
    if (!model) return;
    let disposed = false;
    const forgeApi = (window as any).forge || (window as any).forgeApi;
    if (forgeApi?.getRuntimeResources) {
      void forgeApi
        .getRuntimeResources()
        .then((next: RuntimeResources) => {
          if (!disposed) setResources(next);
        })
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
    };
  }, [model?.id]);

  const estimate = useMemo(
    () => (model ? estimateMemory(model, value) : undefined),
    [model, value],
  );
  const freeVram = totalFreeVram(resources);

  const set = <K extends keyof LoadConfig>(key: K, next: LoadConfig[K]) =>
    onChange({ ...value, [key]: next });

  const number = <K extends keyof LoadConfig>(key: K, raw: string) =>
    set(key, (raw === '' ? 0 : Number(raw)) as LoadConfig[K]);

  const choose = async (
    key: keyof LoadConfig,
    kind: 'mmproj' | 'draft' | 'lora' | 'grammar' | 'template' | 'directory',
  ) => {
    const forgeApi = (window as any).forge || (window as any).forgeApi;
    if (forgeApi?.chooseAuxiliaryFile) {
      const selected = await forgeApi.chooseAuxiliaryFile(kind);
      if (selected) onChange({ ...value, [key]: selected });
    }
  };

  const loadEmbeddedTemplate = async () => {
    if (!model) return;
    setTemplateLoading(true);
    try {
      const forgeApi = (window as any).forge || (window as any).forgeApi;
      const template = await forgeApi?.getModelTemplate(model.id);
      setEmbeddedTemplate(template ?? '');
    } catch {
      setEmbeddedTemplate('');
    } finally {
      setTemplateLoading(false);
    }
  };

  return (
    <div className={`settings-sections ${compact ? 'compact' : ''}`}>
      <Section title="Performance & hardware" icon={<Cpu size={14} />}>
        <Field label="GPU offload layers" description="auto, all, or an exact layer count" inline>
          <TextInput
            value={value.gpuLayers}
            onChange={(event) => set('gpuLayers', event.target.value)}
          />
        </Field>
        <Field label="Compute devices" description="Comma-separated; blank uses llama.cpp default">
          <TextInput
            value={value.device}
            onChange={(event) => set('device', event.target.value)}
            placeholder="CUDA0,Vulkan0"
          />
        </Field>
        <Field label="Split mode" inline>
          <Select
            value={value.splitMode}
            onChange={(event) =>
              set('splitMode', event.target.value as LoadConfig['splitMode'])
            }
          >
            <option value="none">Single GPU</option>
            <option value="layer">Layer split</option>
            <option value="row">Row split</option>
            <option value="tensor">Tensor split (experimental)</option>
          </Select>
        </Field>
        {value.splitMode !== 'none' && (
          <Field label="Tensor split" description="Per-GPU proportions, e.g. 3,1">
            <TextInput
              value={value.tensorSplit}
              onChange={(event) => set('tensorSplit', event.target.value)}
            />
          </Field>
        )}
        <Field label="Main GPU" inline>
          <TextInput
            type="number"
            min={0}
            value={value.mainGpu}
            onChange={(event) => number('mainGpu', event.target.value)}
          />
        </Field>
        <Field label="Automatic memory fit" inline>
          <Select
            value={value.fit}
            onChange={(event) => set('fit', event.target.value as 'on' | 'off')}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </Select>
        </Field>
        <Field label="Fit margin per GPU" description="MiB values, comma-separated">
          <TextInput
            value={value.fitTarget}
            onChange={(event) => set('fitTarget', event.target.value)}
            placeholder="1024"
          />
        </Field>
        <Field label="Flash Attention" inline>
          <Select
            value={value.flashAttention}
            onChange={(event) =>
              set('flashAttention', event.target.value as LoadConfig['flashAttention'])
            }
          >
            <option value="auto">Auto</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </Select>
        </Field>
        <Field label="CPU threads" inline>
          <TextInput
            type="number"
            value={value.threads}
            onChange={(event) => number('threads', event.target.value)}
          />
        </Field>
        <Field label="Prompt processing threads" inline>
          <TextInput
            type="number"
            value={value.threadsBatch}
            onChange={(event) => number('threadsBatch', event.target.value)}
          />
        </Field>
        <Field label="Keep MoE weights on CPU" inline>
          <Toggle
            label="CPU MoE"
            checked={value.cpuMoe}
            onChange={(next) => set('cpuMoe', next)}
          />
        </Field>
        {!value.cpuMoe && (
          <Field label="First MoE layers on CPU" inline>
            <TextInput
              type="number"
              min={0}
              value={value.cpuMoeLayers}
              onChange={(event) => number('cpuMoeLayers', event.target.value)}
            />
          </Field>
        )}
      </Section>

      <Section
        title="Context & KV cache"
        icon={<Database size={14} />}
        className="context-kv-section"
      >
        {model && estimate && (
          <div className="memory-budget" style={{ padding: '12px', background: 'var(--panel-2)', borderRadius: '6px', marginBottom: '12px' }}>
            <div>
              <strong>
                {formatBytes(estimate.weightsBytes)} weights
                {estimate.kvBytes ? ` + ${formatBytes(estimate.kvBytes)} KV` : ''}
              </strong>
              <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)' }}>
                {estimate.totalBytes
                  ? `≈ ${formatBytes(estimate.totalBytes)} at ${estimate.contextTokens.toLocaleString()} tokens`
                  : 'Estimate unavailable — rescan this model'}
                {freeVram ? ` · ${formatBytes(freeVram)} VRAM free` : ''}
              </span>
            </div>
            {estimate.kvBytes &&
              (value.cacheTypeK !== 'q8_0' || value.cacheTypeV !== 'q8_0') && (
                <Button
                  style={{ marginTop: '8px' }}
                  onClick={() =>
                    onChange({
                      ...value,
                      cacheTypeK: 'q8_0',
                      cacheTypeV: 'q8_0',
                      flashAttention:
                        value.flashAttention === 'off' ? 'auto' : value.flashAttention,
                    })
                  }
                >
                  Use q8_0 KV
                </Button>
              )}
          </div>
        )}
        <Field label="Context length" description="0 = model maximum" inline>
          <TextInput
            type="number"
            min={0}
            value={value.contextSize}
            onChange={(event) => number('contextSize', event.target.value)}
          />
        </Field>
        <Field label="Logical batch size" inline>
          <TextInput
            type="number"
            value={value.batchSize}
            onChange={(event) => number('batchSize', event.target.value)}
          />
        </Field>
        <Field label="Physical micro-batch" inline>
          <TextInput
            type="number"
            value={value.ubatchSize}
            onChange={(event) => number('ubatchSize', event.target.value)}
          />
        </Field>
        <Field label="K cache precision" inline>
          <CacheTypeSelect value={value.cacheTypeK} onChange={(next) => set('cacheTypeK', next)} />
        </Field>
        <Field label="V cache precision" inline>
          <CacheTypeSelect value={value.cacheTypeV} onChange={(next) => set('cacheTypeV', next)} />
        </Field>
        <Field label="Offload KV cache" inline>
          <Toggle
            label="KV offload"
            checked={value.kvOffload}
            onChange={(next) => set('kvOffload', next)}
          />
        </Field>
        <Field label="Offload host operations" inline>
          <Toggle
            label="Operation offload"
            checked={value.opOffload}
            onChange={(next) => set('opOffload', next)}
          />
        </Field>
        <Field label="Context shifting" inline>
          <Toggle
            label="Context shift"
            checked={value.contextShift}
            onChange={(next) => set('contextShift', next)}
          />
        </Field>
        <Field label="Prompt cache" inline>
          <Toggle
            label="Prompt cache"
            checked={value.promptCache}
            onChange={(next) => set('promptCache', next)}
          />
        </Field>
        <Field label="RAM cache limit (MiB)" inline>
          <TextInput
            type="number"
            value={value.cacheRam}
            onChange={(event) => number('cacheRam', event.target.value)}
          />
        </Field>
      </Section>

      <Section title="Model loading" icon={<Layers3 size={14} />} defaultOpen={!compact}>
        <Field label="Load mode" inline>
          <Select
            value={value.loadMode}
            onChange={(event) =>
              set('loadMode', event.target.value as LoadConfig['loadMode'])
            }
          >
            <option value="mmap">Memory map</option>
            <option value="mlock">Memory map + lock</option>
            <option value="dio">Direct I/O</option>
            <option value="none">Buffered</option>
          </Select>
        </Field>
        <Field label="Weight repacking" inline>
          <Toggle
            label="Weight repacking"
            checked={value.repack}
            onChange={(next) => set('repack', next)}
          />
        </Field>
        <Field label="Check tensors on load" inline>
          <Toggle
            label="Check tensors"
            checked={value.checkTensors}
            onChange={(next) => set('checkTensors', next)}
          />
        </Field>
        <Field label="Warm up before serving" inline>
          <Toggle
            label="Warmup"
            checked={value.warmup}
            onChange={(next) => set('warmup', next)}
          />
        </Field>
      </Section>

      <Section title="Serving & endpoints" icon={<Globe2 size={14} />} defaultOpen={false}>
        <Field
          label="On-demand GPU loading"
          description="Keep the API online, load the requested model for inference, then release memory when idle."
          inline
        >
          <Toggle
            label="On-demand GPU loading"
            checked={value.onDemandLoading}
            onChange={(next) => set('onDemandLoading', next)}
          />
        </Field>
        <Field label="Listen address" inline>
          <TextInput
            value={value.host}
            onChange={(event) => set('host', event.target.value)}
          />
        </Field>
        <Field label="Port" inline>
          <TextInput
            type="number"
            min={1}
            max={65535}
            value={value.port}
            onChange={(event) => number('port', event.target.value)}
          />
        </Field>
        <Field label="API model alias">
          <TextInput
            value={value.alias}
            onChange={(event) => set('alias', event.target.value)}
          />
        </Field>
        <Field label="API key">
          <TextInput
            type="password"
            value={value.apiKey}
            onChange={(event) => set('apiKey', event.target.value)}
            placeholder="Optional"
          />
        </Field>
        <NumberField label="Parallel request slots" value={value.parallel} onChange={(next) => set('parallel', next)} />
        <Field label="Metrics endpoint" inline>
          <Toggle label="Metrics" checked={value.metrics} onChange={(next) => set('metrics', next)} />
        </Field>
        <Field label="Slots endpoint" inline>
          <Toggle label="Slots" checked={value.slots} onChange={(next) => set('slots', next)} />
        </Field>
      </Section>

      <Section title="Advanced command line" icon={<Wrench size={14} />} defaultOpen={false}>
        <Field
          label="Extra llama-server arguments"
          description="Appended after structured options. Quoted values are supported."
        >
          <TextArea
            rows={4}
            className="code-input"
            value={value.extraArgs}
            onChange={(event) => set('extraArgs', event.target.value)}
            placeholder="--prio 2 --poll 80"
          />
        </Field>
      </Section>
    </div>
  );
}

function CacheTypeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onChange={(event) => onChange(event.target.value)}>
      {['f32', 'f16', 'bf16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0', 'iq4_nl'].map(
        (type) => (
          <option value={type} key={type}>
            {type}
          </option>
        ),
      )}
    </Select>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} inline>
      <TextInput
        type="number"
        value={value}
        step="any"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

function PathField({
  label,
  value,
  onChange,
  onBrowse,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <TextInput
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        <Button onClick={onBrowse}>Browse</Button>
      </div>
    </Field>
  );
}
