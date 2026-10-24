'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Settings,
  Save,
  Trash2,
  Database,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import { formatShortTimestamp } from '@/components/format';

interface IntegrationConnection {
  id: string;
  name: string;
  type: string;
  status: string;
  authSource: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  capabilities: Record<string, string>;
  diagnostics: Record<string, unknown>;
}

export default function SettingsPage() {
  const [workspaceRootsText, setWorkspaceRootsText] = useState('');
  const [exclusionsText, setExclusionsText] = useState('');
  const [refreshInterval, setRefreshInterval] = useState(15);
  const [retentionDays, setRetentionDays] = useState(30);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [cooldownSeconds, setCooldownSeconds] = useState(120);
  const [costThreshold, setCostThreshold] = useState(25);
  const [databasePath, setDatabasePath] = useState('');
  const [integrations, setIntegrations] = useState<IntegrationConnection[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const loadSettings = useCallback(async () => {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      const s = data.settings || {};
      setWorkspaceRootsText(Array.isArray(s.workspaceRoots) ? s.workspaceRoots.join('\n') : '');
      setExclusionsText(
        Array.isArray(s.monitoringExclusions) ? s.monitoringExclusions.join(', ') : ''
      );
      setRefreshInterval(Number(s.refreshIntervalSeconds ?? 15));
      setRetentionDays(Number(s.retentionDays ?? 30));
      setNotificationsEnabled(Boolean(s.notificationsEnabled ?? true));
      setCooldownSeconds(Number(s.notificationCooldownSeconds ?? 120));
      setCostThreshold(Number(s.costThresholdUsd ?? 25));
      setDatabasePath(data.databasePath || '');
      setIntegrations(data.integrations || []);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const workspaceRoots = workspaceRootsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const monitoringExclusions = exclusionsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_settings',
        settings: {
          workspaceRoots,
          monitoringExclusions,
          refreshIntervalSeconds: refreshInterval,
          retentionDays,
          notificationsEnabled,
          notificationCooldownSeconds: cooldownSeconds,
          costThresholdUsd: costThreshold,
        },
      }),
    });
    if (res.ok) {
      setStatusMessage('Configuration saved to local SQLite database.');
      void loadSettings();
    }
  };

  const handleApplyRetention = async () => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'apply_retention',
        retentionDays,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setStatusMessage(
        `Retention policy applied (${data.result?.deletedEvents ?? 0} expired events removed).`
      );
    }
  };

  const handleClearHistory = async (scope: 'events' | 'errors' | 'usage' | 'all') => {
    if (!confirmClear) {
      setStatusMessage('Please check the confirmation box before purging monitoring history.');
      return;
    }
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'clear_history',
        clearScope: scope,
        confirmClear: true,
      }),
    });
    if (res.ok) {
      setStatusMessage(`Purged local ${scope} history.`);
      setConfirmClear(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
        <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <Settings className="w-5 h-5 text-zinc-400" />
          Settings, Data Retention & Connector Diagnostics
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          Configure workspace roots, exclusions, notification thresholds, data retention, and inspect connector states.
        </p>
      </div>

      {statusMessage && (
        <div className="p-3 rounded border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 6 cols: Application Settings & Retention */}
        <div className="lg:col-span-6 space-y-5">
          <form
            onSubmit={(e) => void handleSaveSettings(e)}
            className="rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4 space-y-4 text-xs"
          >
            <div className="font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-200 dark:border-zinc-800 pb-2">
              Monitoring Scope & Preferences
            </div>

            <div>
              <label className="block font-medium mb-1">Workspace Roots (One path per line)</label>
              <textarea
                rows={3}
                value={workspaceRootsText}
                onChange={(e) => setWorkspaceRootsText(e.target.value)}
                className="w-full p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono text-xs outline-none"
              />
            </div>

            <div>
              <label className="block font-medium mb-1">
                Filesystem Exclusions (Comma-separated directory names)
              </label>
              <input
                type="text"
                value={exclusionsText}
                onChange={(e) => setExclusionsText(e.target.value)}
                className="w-full p-2 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono text-xs outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium mb-1">Refresh Interval (Seconds)</label>
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={refreshInterval}
                  onChange={(e) => setRefreshInterval(Number(e.target.value))}
                  className="w-full p-2 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono outline-none"
                />
              </div>

              <div>
                <label className="block font-medium mb-1">Est. Cost Alert Threshold ($ USD)</label>
                <input
                  type="number"
                  step="0.5"
                  min={1}
                  value={costThreshold}
                  onChange={(e) => setCostThreshold(Number(e.target.value))}
                  className="w-full p-2 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 items-center">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(e) => setNotificationsEnabled(e.target.checked)}
                />
                <span>Enable Local Alert Notifications</span>
              </label>

              <div>
                <label className="block font-medium mb-1">Alert Cooldown (Seconds)</label>
                <input
                  type="number"
                  min={10}
                  value={cooldownSeconds}
                  onChange={(e) => setCooldownSeconds(Number(e.target.value))}
                  className="w-full p-2 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 font-medium"
            >
              <Save className="w-3.5 h-3.5" /> Save Configuration
            </button>
          </form>

          {/* Data Retention & Storage Controls */}
          <div className="rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4 space-y-4 text-xs">
            <div className="font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-200 dark:border-zinc-800 pb-2 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-sky-500" /> Local SQLite Storage & Data Retention
            </div>

            <div className="font-mono text-[11px] text-zinc-500">
              Database File: <span className="text-zinc-900 dark:text-zinc-100">{databasePath}</span>
            </div>

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block font-medium mb-1">Retention Period (Days)</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(Number(e.target.value))}
                  className="w-full p-2 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleApplyRetention()}
                className="px-3 py-2 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium"
              >
                Prune Expired Records
              </button>
            </div>

            <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
              <label className="inline-flex items-center gap-2 text-red-500 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmClear}
                  onChange={(e) => setConfirmClear(e.target.checked)}
                />
                <span>Confirm destructive deletion of locally stored monitoring history</span>
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!confirmClear}
                  onClick={() => void handleClearHistory('events')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-500/30 text-red-500 hover:bg-red-500/10 disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear Activity Events
                </button>
                <button
                  type="button"
                  disabled={!confirmClear}
                  onClick={() => void handleClearHistory('errors')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-500/30 text-red-500 hover:bg-red-500/10 disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear Error Centre
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right 6 cols: Connector Diagnostics */}
        <div className="lg:col-span-6 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4 space-y-4 text-xs">
          <div className="font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-200 dark:border-zinc-800 pb-2 flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-emerald-500" /> Connector Diagnostics & Capabilities
          </div>

          <div className="space-y-3">
            {integrations.map((conn) => (
              <div
                key={conn.id}
                className="p-3 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{conn.name}</span>
                  <span className="px-2 py-0.5 rounded font-mono text-[10px] uppercase bg-emerald-500/10 text-emerald-500">
                    {conn.status}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-zinc-500">
                  Auth/Source: {conn.authSource} · Last Sync:{' '}
                  {formatShortTimestamp(conn.lastSuccessAt)}
                </div>
                {conn.lastError && (
                  <div className="font-mono text-[11px] text-amber-500">
                    Note: {conn.lastError}
                  </div>
                )}
                <div className="space-y-1 pt-1 border-t border-zinc-200/60 dark:border-zinc-800/60 font-mono text-[11px]">
                  {Object.entries(conn.capabilities || {}).map(([k, v]) => (
                    <div key={k} className="text-zinc-600 dark:text-zinc-400">
                      <strong className="text-zinc-800 dark:text-zinc-200">{k}:</strong> {v}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
