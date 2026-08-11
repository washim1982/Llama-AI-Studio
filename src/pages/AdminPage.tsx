import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BarChart3,
  CircleDollarSign,
  Clock3,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react'
import type {
  AdminDashboardSnapshot,
  ApiTrace,
  AppSettings,
  GeneratedApiKey,
} from '../types'
import { Button, EmptyState, Notice, Select, StatusPill, TextInput } from '../components/Controls'
import { copyText, errorMessage, formatCount } from '../utils'

export function AdminPage({ settings }: { settings: AppSettings }) {
  const api = window.forge
  const [snapshot, setSnapshot] = useState<AdminDashboardSnapshot>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [userName, setUserName] = useState('')
  const [inputRate, setInputRate] = useState(
    String(settings.apiGateway.defaultInputCostPerMillion),
  )
  const [outputRate, setOutputRate] = useState(
    String(settings.apiGateway.defaultOutputCostPerMillion),
  )
  const [generated, setGenerated] = useState<GeneratedApiKey>()
  const [copied, setCopied] = useState(false)
  const [keyFilter, setKeyFilter] = useState('all')
  const [endpointFilter, setEndpointFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [selectedTrace, setSelectedTrace] = useState<ApiTrace>()

  const refresh = async () => {
    try {
      setSnapshot(await api.getAdminDashboard())
      setError(undefined)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  useEffect(() => {
    void refresh()
    const off = api.onAdminUpdated?.(setSnapshot)
    const timer = window.setInterval(() => void refresh(), 15_000)
    return () => {
      off?.()
      window.clearInterval(timer)
    }
  }, [])

  const traces = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return (snapshot?.traces ?? []).filter((trace) => {
      if (keyFilter !== 'all' && trace.apiKeyId !== keyFilter) return false
      if (endpointFilter !== 'all' && trace.endpoint !== endpointFilter) return false
      if (statusFilter === 'success' && trace.status >= 400) return false
      if (statusFilter === 'error' && trace.status < 400) return false
      if (!normalizedQuery) return true
      return [trace.requestId, trace.apiKeyName, trace.path, trace.model, trace.error]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery))
    })
  }, [endpointFilter, keyFilter, query, snapshot?.traces, statusFilter])

  const generateKey = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const next = await api.createApiKey({
        userName,
        inputCostPerMillion: Number(inputRate),
        outputCostPerMillion: Number(outputRate),
      })
      setGenerated(next)
      setUserName('')
      setCopied(false)
      await refresh()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: string, name: string) => {
    if (!window.confirm(`Revoke the API key for ${name}? Existing clients will stop working immediately.`)) {
      return
    }
    setBusy(true)
    try {
      await api.revokeApiKey(id)
      await refresh()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const copySecret = async () => {
    if (!generated) return
    await copyText(generated.secret)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2_000)
  }

  if (!snapshot) {
    return <div className="admin-loading"><RefreshCw className="spin" size={18} /> Loading API operations…</div>
  }

  const errorRate = snapshot.summary.requests
    ? (snapshot.summary.errors / snapshot.summary.requests) * 100
    : 0

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div>
          <span className="admin-eyebrow"><ShieldCheck size={13} /> ADMIN CONTROL PLANE</span>
          <h1>API operations</h1>
          <p>Authentication, metering, billing, and request traces for your inference gateway.</p>
        </div>
        <div className="gateway-control">
          <div>
            <StatusPill status={snapshot.gateway.state === 'running' ? 'running' : snapshot.gateway.state === 'error' ? 'error' : 'stopped'}>
              Gateway {snapshot.gateway.state}
            </StatusPill>
            <code>{snapshot.gateway.url}/v1</code>
          </div>
          <Button onClick={() => void copyText(`${snapshot.gateway.url}/v1`)}>
            <Copy size={13} /> Copy base URL
          </Button>
          <Button onClick={() => void refresh()} aria-label="Refresh dashboard">
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
      </header>

      {error && <Notice kind="danger" onClose={() => setError(undefined)}>{error}</Notice>}
      {snapshot.gateway.error && <Notice kind="danger">Gateway failed to start: {snapshot.gateway.error}</Notice>}

      <section className="admin-stat-grid">
        <MetricCard icon={<Activity />} label="Requests" value={formatCount(snapshot.summary.requests)} detail={`${snapshot.activeKeys} active keys`} tone="purple" />
        <MetricCard icon={<Zap />} label="Tokens" value={formatCount(snapshot.summary.totalTokens)} detail={`${formatCount(snapshot.summary.promptTokens)} in · ${formatCount(snapshot.summary.completionTokens)} out`} tone="blue" />
        <MetricCard icon={<CircleDollarSign />} label="Billed usage" value={formatMoney(snapshot.summary.cost)} detail="Based on per-key rates" tone="green" />
        <MetricCard icon={<Clock3 />} label="P95 latency" value={formatDuration(snapshot.summary.p95LatencyMs)} detail={`${errorRate.toFixed(1)}% error rate`} tone={errorRate > 5 ? 'red' : 'amber'} />
      </section>

      <section className="admin-top-grid">
        <div className="admin-panel traffic-panel">
          <PanelHeading icon={<BarChart3 size={15} />} title="Request traffic" detail="Last 24 hours" />
          <TrafficChart snapshot={snapshot} />
        </div>
        <form className="admin-panel key-generator" onSubmit={generateKey}>
          <PanelHeading icon={<KeyRound size={15} />} title="Issue API key" detail="Secret shown once" />
          <label>
            <span>User or service</span>
            <TextInput value={userName} onChange={(event) => setUserName(event.target.value)} placeholder="e.g. Analytics team" maxLength={120} />
          </label>
          <div className="rate-fields">
            <label>
              <span>Input / 1M tokens</span>
              <TextInput type="number" min="0" step="0.0001" value={inputRate} onChange={(event) => setInputRate(event.target.value)} prefix={<span>$</span>} />
            </label>
            <label>
              <span>Output / 1M tokens</span>
              <TextInput type="number" min="0" step="0.0001" value={outputRate} onChange={(event) => setOutputRate(event.target.value)} prefix={<span>$</span>} />
            </label>
          </div>
          <Button variant="primary" type="submit" loading={busy} disabled={!userName.trim()}>
            <Plus size={14} /> Generate key
          </Button>
        </form>
      </section>

      {generated && (
        <section className="generated-key-banner">
          <div className="generated-icon"><KeyRound size={18} /></div>
          <div>
            <strong>Copy the key for {generated.key.userName}</strong>
            <span>It cannot be recovered after you dismiss this message.</span>
            <code>{generated.secret}</code>
          </div>
          <Button variant="primary" onClick={copySecret}><Copy size={13} /> {copied ? 'Copied' : 'Copy secret'}</Button>
          <Button variant="ghost" onClick={() => setGenerated(undefined)} aria-label="Dismiss generated key"><X size={15} /></Button>
        </section>
      )}

      <section className="admin-panel key-table-panel">
        <PanelHeading icon={<Users size={15} />} title="API keys & billing" detail="All-time usage by credential" />
        {snapshot.keys.length ? (
          <div className="admin-table-scroll">
            <table className="admin-table key-table">
              <thead><tr><th>User / service</th><th>Key</th><th>Status</th><th>Requests</th><th>Tokens</th><th>Input rate</th><th>Output rate</th><th>Billed</th><th>Last used</th><th /></tr></thead>
              <tbody>
                {snapshot.keys.map((item) => (
                  <tr key={item.key.id}>
                    <td><strong>{item.key.userName}</strong><small>Created {formatDate(item.key.createdAt)}</small></td>
                    <td><code>{item.key.prefix}</code></td>
                    <td><span className={`key-status ${item.key.revokedAt ? 'revoked' : 'active'}`}>{item.key.revokedAt ? 'Revoked' : 'Active'}</span></td>
                    <td>{formatCount(item.requests)}</td>
                    <td>{formatCount(item.totalTokens)}</td>
                    <td>{formatMoney(item.key.inputCostPerMillion)}</td>
                    <td>{formatMoney(item.key.outputCostPerMillion)}</td>
                    <td><strong>{formatMoney(item.cost)}</strong></td>
                    <td>{item.lastRequestAt ? timeAgo(item.lastRequestAt) : 'Never'}</td>
                    <td>
                      {!item.key.revokedAt && (
                        <button className="table-action danger" onClick={() => void revoke(item.key.id, item.key.userName)} disabled={busy} title="Revoke key"><Trash2 size={13} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<KeyRound size={22} />} title="No API keys yet" description="Generate the first credential to authenticate a user or service and begin metering usage." />
        )}
      </section>

      <section className="admin-panel trace-panel">
        <div className="trace-heading">
          <PanelHeading icon={<Activity size={15} />} title="Request traces" detail={`${traces.length} recent calls`} />
          <div className="trace-filters">
            <TextInput prefix={<Search size={13} />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Request ID, model, error…" />
            <Select value={keyFilter} onChange={(event) => setKeyFilter(event.target.value)}>
              <option value="all">All API keys</option>
              {snapshot.keys.map((item) => <option key={item.key.id} value={item.key.id}>{item.key.userName}</option>)}
            </Select>
            <Select value={endpointFilter} onChange={(event) => setEndpointFilter(event.target.value)}>
              <option value="all">All endpoints</option>
              {snapshot.endpoints.map((endpoint) => <option key={endpoint} value={endpoint}>{endpoint}</option>)}
            </Select>
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="success">Successful</option>
              <option value="error">Errors</option>
            </Select>
          </div>
        </div>
        <div className={`trace-layout ${selectedTrace ? 'with-detail' : ''}`}>
          <div className="admin-table-scroll">
            <table className="admin-table trace-table">
              <thead><tr><th>Time</th><th>Status</th><th>API</th><th>User</th><th>Model</th><th>Tokens</th><th>Latency</th><th>Cost</th><th>Request ID</th></tr></thead>
              <tbody>
                {traces.map((trace) => (
                  <tr key={trace.id} className={selectedTrace?.id === trace.id ? 'selected' : ''} onClick={() => setSelectedTrace(trace)}>
                    <td>{formatTraceTime(trace.startedAt)}</td>
                    <td><span className={`http-status ${trace.status < 400 ? 'ok' : 'error'}`}>{trace.status}</span></td>
                    <td><strong>{trace.endpoint}</strong><small>{trace.method} {trace.path}</small></td>
                    <td>{trace.apiKeyName}</td>
                    <td>{trace.model ?? '—'}</td>
                    <td>{formatCount(trace.totalTokens)}</td>
                    <td>{formatDuration(trace.durationMs)}</td>
                    <td>{formatMoney(trace.cost)}</td>
                    <td><code>{shortId(trace.requestId)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!traces.length && <EmptyState icon={<Search size={22} />} title="No matching traces" description="Requests appear here as clients call the authenticated gateway." />}
          </div>
          {selectedTrace && <TraceDetail trace={selectedTrace} onClose={() => setSelectedTrace(undefined)} />}
        </div>
      </section>
    </div>
  )
}

function MetricCard({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <div className={`metric-card ${tone}`}><span className="metric-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div></div>
}

function PanelHeading({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="admin-panel-heading"><span>{icon}<strong>{title}</strong></span><small>{detail}</small></div>
}

function TrafficChart({ snapshot }: { snapshot: AdminDashboardSnapshot }) {
  const maximum = Math.max(1, ...snapshot.traffic.map((bucket) => bucket.requests))
  const total = snapshot.traffic.reduce((sum, bucket) => sum + bucket.requests, 0)
  return (
    <div className="traffic-chart">
      <div className="traffic-summary"><strong>{formatCount(total)}</strong><span>requests in selected window</span></div>
      <div className="traffic-bars">
        {snapshot.traffic.map((bucket, index) => (
          <div className="traffic-column" key={bucket.startedAt} title={`${new Date(bucket.startedAt).toLocaleString()}: ${bucket.requests} requests, ${bucket.tokens} tokens`}>
            <i className={bucket.errors ? 'has-errors' : ''} style={{ height: `${Math.max(bucket.requests ? 7 : 2, (bucket.requests / maximum) * 100)}%` }} />
            {index % 6 === 0 && <small>{new Date(bucket.startedAt).toLocaleTimeString([], { hour: 'numeric' })}</small>}
          </div>
        ))}
      </div>
      <div className="chart-legend"><span><i /> Requests</span><span><i className="error" /> Contains errors</span></div>
    </div>
  )
}

function TraceDetail({ trace, onClose }: { trace: ApiTrace; onClose: () => void }) {
  return (
    <aside className="trace-detail">
      <div className="trace-detail-header"><div><span>TRACE DETAIL</span><strong>{trace.endpoint}</strong></div><button onClick={onClose}><X size={15} /></button></div>
      <dl>
        <div><dt>Request ID</dt><dd><code>{trace.requestId}</code></dd></div>
        <div><dt>Credential</dt><dd>{trace.apiKeyName}</dd></div>
        <div><dt>Route</dt><dd><code>{trace.method} {trace.path}</code></dd></div>
        <div><dt>Model</dt><dd>{trace.model ?? 'Not specified'}</dd></div>
        <div><dt>Status</dt><dd><span className={`http-status ${trace.status < 400 ? 'ok' : 'error'}`}>{trace.status}</span></dd></div>
        <div><dt>Client</dt><dd>{trace.clientIp ?? 'Unknown'}</dd></div>
      </dl>
      <div className="trace-token-grid"><span><small>Input</small><strong>{formatCount(trace.promptTokens)}</strong></span><span><small>Output</small><strong>{formatCount(trace.completionTokens)}</strong></span><span><small>Cost</small><strong>{formatMoney(trace.cost)}</strong></span></div>
      {trace.error && <div className="trace-error">{trace.error}</div>}
      <div className="trace-timeline">
        <strong>Timeline</strong>
        {trace.events.map((event, index) => <div key={`${event.name}-${index}`}><i /><span><b>{event.name.replaceAll('_', ' ')}</b>{event.detail && <small>{event.detail}</small>}</span><time>+{formatDuration(event.atMs)}</time></div>)}
      </div>
    </aside>
  )
}

function formatMoney(value: number) {
  const digits = value > 0 && value < 0.01 ? 6 : 2
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

function formatDuration(value: number) {
  if (value < 1_000) return `${Math.round(value)} ms`
  if (value < 60_000) return `${(value / 1_000).toFixed(2)} s`
  return `${(value / 60_000).toFixed(1)} m`
}

function formatDate(value: number) {
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTraceTime(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function timeAgo(value: number) {
  const elapsed = Date.now() - value
  if (elapsed < 60_000) return 'Just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`
  return `${Math.floor(elapsed / 86_400_000)}d ago`
}

function shortId(value: string) {
  return value.length > 15 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}
