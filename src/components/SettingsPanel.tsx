import { useState, useEffect, useRef } from 'react'
import { AppSettings } from '../types/ipc'

interface Props {
  onClose: () => void
}

export function SettingsPanel({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings>({
    titleProvider: 'anthropic',
    apiKey: '',
    model: 'claude-haiku-4-5-20251001',
    baseUrl: '',
  })
  const [saved, setSaved] = useState(false)
  const [logs, setLogs] = useState<{ level: string; msg: string; ts: number }[]>([])
  const logsContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings)
    window.electronAPI.getLogs().then(setLogs)
    return window.electronAPI.onLog(entry => setLogs(prev => [...prev.slice(-499), entry]))
  }, [])

  useEffect(() => {
    const el = logsContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSave = async () => {
    await window.electronAPI.saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const modelPlaceholder = settings.titleProvider === 'openai-compatible'
    ? 'e.g. moonshot-v1-8k'
    : 'e.g. claude-haiku-4-5-20251001'

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: '#111',
      display: 'flex', flexDirection: 'column',
      zIndex: 50,
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '10px 16px',
        borderBottom: '1px solid #1e1e1e',
      }}>
        <span style={{ color: '#555', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
          Settings
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#555', fontSize: '18px', cursor: 'pointer', lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px', maxWidth: '520px' }}>
        <SectionHeading>AI Session Titles</SectionHeading>
        <p style={{ color: '#555', fontSize: '12px', marginBottom: '24px', lineHeight: 1.6 }}>
          Automatically generate short titles for sessions using an AI API. Titles are cached locally in <code style={{ color: '#666' }}>~/.claude/claudesole-titles.json</code>.
        </p>

        <FormRow label="Title Provider">
          <select
            value={settings.titleProvider}
            onChange={e => setSettings(s => ({ ...s, titleProvider: e.target.value as AppSettings['titleProvider'] }))}
            style={selectStyle}
          >
            <option value="none">None</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai-compatible">OpenAI-compatible</option>
          </select>
        </FormRow>

        {settings.titleProvider !== 'none' && (
          <>
            <FormRow label="API Key">
              <input
                type="password"
                value={settings.apiKey}
                onChange={e => setSettings(s => ({ ...s, apiKey: e.target.value }))}
                placeholder="Paste your API key…"
                style={inputStyle}
              />
            </FormRow>

            <FormRow label="Model">
              <input
                type="text"
                value={settings.model}
                onChange={e => setSettings(s => ({ ...s, model: e.target.value }))}
                placeholder={modelPlaceholder}
                style={inputStyle}
              />
            </FormRow>

            {settings.titleProvider === 'openai-compatible' && (
              <FormRow label="Base URL">
                <input
                  type="text"
                  value={settings.baseUrl}
                  onChange={e => setSettings(s => ({ ...s, baseUrl: e.target.value }))}
                  placeholder="e.g. https://api.moonshot.cn/v1"
                  style={inputStyle}
                />
              </FormRow>
            )}
          </>
        )}

        <div style={{ marginTop: '32px' }}>
          <button
            onClick={handleSave}
            style={{
              padding: '8px 20px',
              background: saved ? 'rgba(74,222,128,0.15)' : '#1d4ed8',
              border: saved ? '1px solid rgba(74,222,128,0.3)' : 'none',
              borderRadius: '6px',
              color: saved ? '#4ade80' : '#e5e5e5',
              fontSize: '13px', fontWeight: 500, cursor: 'pointer',
              transition: 'background 0.2s, color 0.2s',
            }}
          >
            {saved ? 'Saved!' : 'Save'}
          </button>
        </div>

        <div style={{ marginTop: '40px' }}>
          <SectionHeading>Logs</SectionHeading>
          <div ref={logsContainerRef} style={{
            marginTop: '8px',
            background: '#0a0a0a',
            border: '1px solid #1e1e1e',
            borderRadius: '6px',
            padding: '10px 12px',
            height: '260px',
            overflowY: 'auto',
            fontFamily: 'monospace',
            fontSize: '11px',
          }}>
            {logs.length === 0 && <span style={{ color: '#333' }}>No logs yet.</span>}
            {logs.map((entry, i) => (
              <div key={i} style={{
                color: entry.level === 'error' ? '#f87171' : entry.level === 'warn' ? '#fbbf24' : '#666',
                marginBottom: '2px',
                wordBreak: 'break-all',
                whiteSpace: 'pre-wrap',
              }}>
                <span style={{ color: '#333', marginRight: '6px' }}>
                  {new Date(entry.ts).toLocaleTimeString()}
                </span>
                {entry.msg}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '13px', fontWeight: 600, color: '#bbb', marginBottom: '8px' }}>
      {children}
    </div>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px' }}>
      <label style={{ fontSize: '12px', color: '#666', width: '100px', flexShrink: 0, textAlign: 'right' }}>
        {label}
      </label>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid #2a2a2a',
  borderRadius: '6px',
  padding: '6px 10px',
  color: '#e5e5e5',
  fontSize: '12px',
  outline: 'none',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
}
