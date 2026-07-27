import React from 'react';
import { Braces, Gauge, ListRestart, SlidersHorizontal } from 'lucide-react';
import type { SamplingConfig } from '../types';
import { Field, Section, Select, TextArea, TextInput, Toggle } from './Controls';

export function SamplingPanel({
  value,
  onChange,
}: {
  value: SamplingConfig;
  onChange: (value: SamplingConfig) => void;
}) {
  const set = <K extends keyof SamplingConfig>(key: K, next: SamplingConfig[K]) =>
    onChange({ ...value, [key]: next });
  const number = <K extends keyof SamplingConfig>(key: K, raw: string) =>
    set(key, (raw === '' ? 0 : Number(raw)) as SamplingConfig[K]);

  return (
    <div className="settings-sections">
      <Section title="Core sampling" icon={<SlidersHorizontal size={14} />}>
        <RangeField
          label="Temperature"
          value={value.temperature}
          min={0}
          max={2}
          step={0.01}
          onChange={(next) => set('temperature', next)}
        />
        <RangeField
          label="Top P"
          value={value.topP}
          min={0}
          max={1}
          step={0.01}
          onChange={(next) => set('topP', next)}
        />
        <RangeField
          label="Min P"
          value={value.minP}
          min={0}
          max={1}
          step={0.01}
          onChange={(next) => set('minP', next)}
        />
        <Field label="Top K" inline>
          <TextInput
            type="number"
            value={value.topK}
            min={0}
            onChange={(event) => number('topK', event.target.value)}
          />
        </Field>
        <Field label="Typical P" inline>
          <TextInput
            type="number"
            value={value.typicalP}
            min={0}
            max={1}
            step={0.01}
            onChange={(event) => number('typicalP', event.target.value)}
          />
        </Field>
        <Field label="Sampler order">
          <TextInput
            value={value.samplerOrder}
            onChange={(event) => set('samplerOrder', event.target.value)}
          />
        </Field>
      </Section>

      <Section title="Penalties & DRY" icon={<ListRestart size={14} />} defaultOpen={false}>
        <Field label="Repeat last N" inline>
          <TextInput
            type="number"
            value={value.repeatLastN}
            onChange={(event) => number('repeatLastN', event.target.value)}
          />
        </Field>
        <Field label="Repeat penalty" inline>
          <TextInput
            type="number"
            value={value.repeatPenalty}
            min={0}
            step={0.01}
            onChange={(event) => number('repeatPenalty', event.target.value)}
          />
        </Field>
        <Field label="Presence penalty" inline>
          <TextInput
            type="number"
            value={value.presencePenalty}
            step={0.01}
            onChange={(event) => number('presencePenalty', event.target.value)}
          />
        </Field>
        <Field label="Frequency penalty" inline>
          <TextInput
            type="number"
            value={value.frequencyPenalty}
            step={0.01}
            onChange={(event) => number('frequencyPenalty', event.target.value)}
          />
        </Field>
        <Field label="DRY multiplier" inline>
          <TextInput
            type="number"
            value={value.dryMultiplier}
            step={0.01}
            onChange={(event) => number('dryMultiplier', event.target.value)}
          />
        </Field>
      </Section>

      <Section title="Adaptive, XTC & Mirostat" icon={<Gauge size={14} />} defaultOpen={false}>
        <Field label="XTC probability" inline>
          <TextInput
            type="number"
            value={value.xtcProbability}
            min={0}
            max={1}
            step={0.01}
            onChange={(event) => number('xtcProbability', event.target.value)}
          />
        </Field>
        <Field label="XTC threshold" inline>
          <TextInput
            type="number"
            value={value.xtcThreshold}
            min={0}
            max={1}
            step={0.01}
            onChange={(event) => number('xtcThreshold', event.target.value)}
          />
        </Field>
        <Field label="Mirostat" inline>
          <Select
            value={value.mirostat}
            onChange={(event) => set('mirostat', Number(event.target.value) as 0 | 1 | 2)}
          >
            <option value={0}>Disabled</option>
            <option value={1}>Mirostat 1</option>
            <option value={2}>Mirostat 2</option>
          </Select>
        </Field>
      </Section>

      <Section title="Response controls" icon={<Braces size={14} />} defaultOpen={false}>
        <Field
          label="Reasoning output"
          description="Use Direct answer when a model never leaves its thinking phase."
          inline
        >
          <Select
            value={value.reasoningEffort ?? 'auto'}
            onChange={(event) =>
              set(
                'reasoningEffort',
                event.target.value as SamplingConfig['reasoningEffort'],
              )
            }
          >
            <option value="auto">Automatic</option>
            <option value="none">Direct answer</option>
          </Select>
        </Field>
        <Field label="Maximum output tokens" inline>
          <TextInput
            type="number"
            value={value.maxTokens}
            min={-1}
            onChange={(event) => number('maxTokens', event.target.value)}
          />
        </Field>
        <Field label="Seed" description="-1 chooses a random seed" inline>
          <TextInput
            type="number"
            value={value.seed}
            onChange={(event) => number('seed', event.target.value)}
          />
        </Field>
        <Field label="GBNF grammar" description="Constrain generation with llama.cpp grammar">
          <TextArea
            rows={4}
            className="code-input"
            value={value.grammar}
            onChange={(event) => set('grammar', event.target.value)}
            placeholder={'root ::= "yes" | "no"'}
          />
        </Field>
        <Field
          label="JSON Schema"
          description="Schema-constrained output; overrides the plain grammar"
        >
          <TextArea
            rows={5}
            className="code-input"
            value={value.jsonSchema}
            onChange={(event) => set('jsonSchema', event.target.value)}
            placeholder={'{"type":"object","properties":{}}'}
          />
        </Field>
      </Section>
    </div>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          style={{ flex: 1 }}
        />
        <TextInput
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          style={{ width: '70px' }}
        />
      </div>
    </Field>
  );
}
