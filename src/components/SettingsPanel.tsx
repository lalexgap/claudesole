import React, { useState, useEffect, useRef } from 'react'
import clsx from 'clsx'
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
  const [cacheCleared, setCacheCleared] = useState(false)
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

  const handleClearCache = async () => {
    await window.electronAPI.clearAllTitleCache()
    setCacheCleared(true)
    setTimeout(() => setCacheCleared(false), 2000)
  }

  const modelPlaceholder = settings.titleProvider === 'openai-compatible'
    ? 'e.g. moonshot-v1-8k'
    : 'e.g. claude-haiku-4-5-20251001'

  const inputCls = 'w-full box-border bg-white/[0.05] border border-app-500 rounded-md px-2.5 py-1.5 text-neutral-200 text-xs outline-none'

  return (
    <div className="absolute inset-0 bg-app-900 flex flex-col z-50">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-app-700">
        <span className="text-[#555] text-xs font-semibold uppercase tracking-[0.08em] flex-1">
          Settings
        </span>
        <button
          onClick={onClose}
          className="bg-transparent border-0 text-[#555] text-lg cursor-pointer leading-none"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-8 py-8 max-w-[520px]">
        <SectionHeading>AI Session Titles</SectionHeading>
        <p className="text-[#555] text-xs mb-3 leading-relaxed">
          Automatically generate short titles for sessions using an AI API. Titles are cached locally in{' '}
          <code className="text-[#666]">~/.claude/claudesole-titles.json</code>.
        </p>
        <div className="mb-6">
          <button
            onClick={handleClearCache}
            className={clsx(
              'px-3 py-1 rounded-md text-[11px] font-medium cursor-pointer border transition-[background,color] duration-200',
              cacheCleared
                ? 'bg-green-400/[0.15] border-green-400/30 text-green-400'
                : 'bg-transparent border-app-500 text-[#666] hover:text-[#aaa]'
            )}
          >
            {cacheCleared ? 'Cache cleared!' : 'Clear title cache'}
          </button>
        </div>

        <FormRow label="Title Provider">
          <select
            value={settings.titleProvider}
            onChange={e => setSettings(s => ({ ...s, titleProvider: e.target.value as AppSettings['titleProvider'] }))}
            className={clsx(inputCls, 'cursor-pointer')}
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
                className={inputCls}
              />
            </FormRow>

            <FormRow label="Model">
              <input
                type="text"
                value={settings.model}
                onChange={e => setSettings(s => ({ ...s, model: e.target.value }))}
                placeholder={modelPlaceholder}
                className={inputCls}
              />
            </FormRow>

            {settings.titleProvider === 'openai-compatible' && (
              <FormRow label="Base URL">
                <input
                  type="text"
                  value={settings.baseUrl}
                  onChange={e => setSettings(s => ({ ...s, baseUrl: e.target.value }))}
                  placeholder="e.g. https://api.moonshot.cn/v1"
                  className={inputCls}
                />
              </FormRow>
            )}
          </>
        )}

        <div className="mt-8">
          <button
            onClick={handleSave}
            className={clsx(
              'px-5 py-2 rounded-md text-[13px] font-medium cursor-pointer border transition-[background,color] duration-200',
              saved
                ? 'bg-green-400/[0.15] border-green-400/30 text-green-400'
                : 'bg-blue-700 border-transparent text-neutral-200'
            )}
          >
            {saved ? 'Saved!' : 'Save'}
          </button>
        </div>

        <div className="mt-10">
          <SectionHeading>Logs</SectionHeading>
          <div
            ref={logsContainerRef}
            className="mt-2 bg-app-950 border border-app-700 rounded-md px-3 py-2.5 h-[260px] overflow-y-auto font-mono text-[11px]"
          >
            {logs.length === 0 && <span className="text-[#333]">No logs yet.</span>}
            {logs.map((entry, i) => (
              <div
                key={i}
                className={clsx(
                  'mb-0.5 break-all whitespace-pre-wrap',
                  entry.level === 'error' ? 'text-red-400' : entry.level === 'warn' ? 'text-amber-400' : 'text-[#666]'
                )}
              >
                <span className="text-[#333] mr-1.5">
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
    <div className="text-[13px] font-semibold text-[#bbb] mb-2">
      {children}
    </div>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 mb-3.5">
      <label className="text-xs text-[#666] w-[100px] shrink-0 text-right">
        {label}
      </label>
      <div className="flex-1">{children}</div>
    </div>
  )
}
