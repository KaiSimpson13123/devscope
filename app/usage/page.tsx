'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Coins,
  Download,
  Info,
  CheckCircle2,
  AlertCircle,
  Sliders,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
} from 'recharts';
import { useLiveStream } from '@/components/AppShell';
import {
  formatNumber,
  formatEstimatedCost,
  formatReportedCost,
  formatShortTimestamp,
} from '@/components/format';

interface UsageSummaryResponse {
  range: string;
  pricingVersion: string;
  totals: {
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
    pricedRequestCount: number;
    unpricedRequestCount: number;
    reportedCostUsd: number | null;
    averageCostPerTaskUsd: number | null;
  };
  currentSession: {
    sessionId: string | null;
    title: string | null;
    model: string;
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
  };
  byModel: Array<{
    model: string;
    provider: string;
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
    reportedCostUsd: number | null;
    pricingAvailable: boolean;
  }>;
  byProject: Array<{
    projectId: string;
    projectName: string;
    requestCount: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
  }>;
  byDay: Array<{
    date: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    requestCount: number;
  }>;
  records: Array<{
    id: string;
    provider: string;
    model: string;
    source: string;
    sessionId: string | null;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
    reportedCostUsd: number | null;
    pricingVersion: string;
    dataOrigin: string;
    timestamp: string;
  }>;
  providers: Array<{
    id: string;
    name: string;
    status: string;
    dataSource: string;
    exposesTokens: boolean;
    exposesReportedBilling: boolean;
    explanation: string;
  }>;
  pricingTable: {
    version: string;
    updatedAt: string;
    note: string;
    models: Array<{
      modelPattern: string;
      displayName: string;
      provider: string;
      inputPerMillionUsd: number;
      outputPerMillionUsd: number;
      cachedInputPerMillionUsd: number;
    }>;
  };
}

export default function UsagePage() {
  const { lastEventTick } = useLiveStream();
  const [range, setRange] = useState<'session' | 'today' | '7d' | '30d' | 'all'>('30d');
  const [data, setData] = useState<UsageSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPricingEditor, setShowPricingEditor] = useState(false);

  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch(`/api/usage?range=${range}`);
      if (res.ok) {
        const json = (await res.json()) as UsageSummaryResponse;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage, lastEventTick]);

  if (loading && !data) {
    return <div className="text-xs text-zinc-500 py-8">Loading verified AI usage telemetry...</div>;
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Header & Range Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
        <div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <Coins className="w-5 h-5 text-amber-500" />
            AI Model Usage & Cost Accounting
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Measured token consumption from local transcripts with strict separation between estimated and provider-reported costs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['session', 'today', '7d', '30d', 'all'] as const).map((preset) => (
            <button
              key={preset}
              onClick={() => setRange(preset)}
              className={`px-2.5 py-1 rounded text-xs font-mono uppercase transition-colors ${
                range === preset
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                  : 'border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {preset === 'session' ? 'Active Session' : preset}
            </button>
          ))}

          <button
            onClick={() => setShowPricingEditor((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-mono"
          >
            <Sliders className="w-3.5 h-3.5 text-amber-500" /> Pricing ({data.pricingVersion})
          </button>

          <a
            href="/api/export?type=usage&format=csv"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-mono"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </a>
          <a
            href="/api/export?type=usage&format=json"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-mono"
          >
            <Download className="w-3.5 h-3.5" /> JSON
          </a>
        </div>
      </div>

      {/* Accounting Integrity Notice */}
      <div className="p-3 rounded border border-amber-500/30 bg-amber-500/5 flex items-start gap-2.5 text-xs">
        <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-zinc-700 dark:text-zinc-300">
          <strong>Accounting Policy:</strong> Token counts (<code className="font-mono">input_tokens</code>,{' '}
          <code className="font-mono">output_tokens</code>, <code className="font-mono">cache_read_tokens</code>) are{' '}
          <strong>measured</strong> directly from Antigravity transcript steps. When a session exposes its model identifier,
          DevScope computes a clearly labeled <strong>Estimated Cost</strong> using configurable pricing table{' '}
          <code className="font-mono">{data.pricingVersion}</code>. Sessions where the model name is not exposed show tokens
          without inventing a dollar figure. Direct provider invoice billing is reported as{' '}
          <code className="font-mono">Unavailable from this source</code> unless an external billing adapter is connected.
        </div>
      </div>

      {/* Configurable Pricing Table Drawer */}
      {showPricingEditor && (
        <div className="p-4 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-semibold">Versioned Reference Pricing Table ({data.pricingTable.version})</span>
              <p className="text-zinc-500 mt-0.5">{data.pricingTable.note}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono text-[11px]">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 uppercase">
                  <th className="py-1.5 px-2">Model Pattern</th>
                  <th className="py-1.5 px-2">Display Name</th>
                  <th className="py-1.5 px-2">Provider</th>
                  <th className="py-1.5 px-2 text-right">Input / 1M</th>
                  <th className="py-1.5 px-2 text-right">Output / 1M</th>
                  <th className="py-1.5 px-2 text-right">Cached / 1M</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                {data.pricingTable.models.map((m) => (
                  <tr key={m.modelPattern}>
                    <td className="py-1.5 px-2">{m.modelPattern}</td>
                    <td className="py-1.5 px-2 text-zinc-900 dark:text-zinc-100">{m.displayName}</td>
                    <td className="py-1.5 px-2 text-zinc-500">{m.provider}</td>
                    <td className="py-1.5 px-2 text-right">${m.inputPerMillionUsd.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right">${m.outputPerMillionUsd.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right">${m.cachedInputPerMillionUsd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top 6 Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 font-mono">
        <div className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50">
          <div className="text-[11px] text-zinc-500 uppercase">Model Turns</div>
          <div className="mt-1.5 text-lg font-semibold tabular-nums">
            {formatNumber(data.totals.requestCount)}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">
            {data.totals.pricedRequestCount} priced · {data.totals.unpricedRequestCount} unpriced
          </div>
        </div>

        <div className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50">
          <div className="text-[11px] text-zinc-500 uppercase">Input Tokens</div>
          <div className="mt-1.5 text-lg font-semibold tabular-nums">
            {formatNumber(data.totals.inputTokens)}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">Measured prompt input</div>
        </div>

        <div className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50">
          <div className="text-[11px] text-zinc-500 uppercase">Cached Tokens</div>
          <div className="mt-1.5 text-lg font-semibold tabular-nums text-sky-500">
            {formatNumber(data.totals.cachedTokens)}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">Measured cache_read_tokens</div>
        </div>

        <div className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50">
          <div className="text-[11px] text-zinc-500 uppercase">Output Tokens</div>
          <div className="mt-1.5 text-lg font-semibold tabular-nums">
            {formatNumber(data.totals.outputTokens)}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">Measured completion</div>
        </div>

        <div className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50">
          <div className="text-[11px] text-zinc-500 uppercase">Estimated Cost</div>
          <div className="mt-1.5 text-lg font-semibold tabular-nums text-amber-500">
            {formatEstimatedCost(data.totals.estimatedCostUsd)}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">
            Avg/task: {formatEstimatedCost(data.totals.averageCostPerTaskUsd)}
          </div>
        </div>

        <div className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50">
          <div className="text-[11px] text-zinc-500 uppercase">Reported Billing</div>
          <div className="mt-1.5 text-xs font-semibold text-zinc-500">
            {formatReportedCost(data.totals.reportedCostUsd)}
          </div>
          <div className="mt-1 text-[10px] text-zinc-400">No invoice API connected</div>
        </div>
      </div>

      {/* Charts Row: Token Usage by Day & Estimated Cost by Day */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
            Measured Token Usage Over Time
          </div>
          <div className="h-60">
            {data.byDay.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-zinc-500">
                No usage records in selected range
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#71717a' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#71717a' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#18181b',
                      borderColor: '#27272a',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="inputTokens" name="Input Tokens" stackId="a" fill="#0ea5e9" />
                  <Bar dataKey="cachedTokens" name="Cached Tokens" stackId="a" fill="#6366f1" />
                  <Bar dataKey="outputTokens" name="Output Tokens" stackId="a" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
            Estimated Cost Over Time (USD — Pricing {data.pricingVersion})
          </div>
          <div className="h-60">
            {data.byDay.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-zinc-500">
                No priced usage records in selected range
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#71717a' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#71717a' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#18181b',
                      borderColor: '#27272a',
                      fontSize: '12px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="estimatedCostUsd"
                    name="Estimated Cost ($)"
                    stroke="#f59e0b"
                    fill="#f59e0b"
                    fillOpacity={0.15}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Usage by Model & Usage by Project */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold uppercase tracking-wider">
            Usage Breakdown by Model
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 text-[11px] uppercase text-zinc-500 bg-zinc-50/50 dark:bg-zinc-900/60">
                  <th className="py-2 px-3">Model</th>
                  <th className="py-2 px-3">Turns</th>
                  <th className="py-2 px-3 text-right">Input</th>
                  <th className="py-2 px-3 text-right">Cached</th>
                  <th className="py-2 px-3 text-right">Output</th>
                  <th className="py-2 px-3 text-right">Estimated Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                {data.byModel.map((m) => (
                  <tr key={`${m.provider}-${m.model}`}>
                    <td className="py-2.5 px-3">
                      <div className="font-sans font-medium text-zinc-900 dark:text-zinc-100">
                        {m.model}
                      </div>
                      <div className="text-[10px] text-zinc-500">{m.provider}</div>
                    </td>
                    <td className="py-2.5 px-3 tabular-nums">{formatNumber(m.requestCount)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {formatNumber(m.inputTokens)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-sky-500">
                      {formatNumber(m.cachedTokens)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {formatNumber(m.outputTokens)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-amber-500">
                      {formatEstimatedCost(m.estimatedCostUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold uppercase tracking-wider">
            Usage Breakdown by Project
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 text-[11px] uppercase text-zinc-500 bg-zinc-50/50 dark:bg-zinc-900/60">
                  <th className="py-2 px-3">Project</th>
                  <th className="py-2 px-3 text-right">Turns</th>
                  <th className="py-2 px-3 text-right">Total Tokens</th>
                  <th className="py-2 px-3 text-right">Estimated Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                {data.byProject.map((p) => (
                  <tr key={p.projectId}>
                    <td className="py-2.5 px-3 font-sans font-medium text-zinc-900 dark:text-zinc-100">
                      {p.projectName}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {formatNumber(p.requestCount)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {formatNumber(p.totalTokens)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-amber-500">
                      {formatEstimatedCost(p.estimatedCostUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Usage Data Sources & Provider Adapters */}
      <div className="rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4 space-y-3 text-xs">
        <div className="font-semibold uppercase tracking-wider text-zinc-500">
          Usage Provider Adapters & Verification Status
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.providers.map((prov) => (
            <div
              key={prov.id}
              className="p-3 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60 space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold flex items-center gap-1.5">
                  {prov.status === 'connected' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                  )}
                  {prov.name}
                </span>
                <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800">
                  {prov.status.replace('_', ' ')}
                </span>
              </div>
              <p className="text-zinc-600 dark:text-zinc-400 text-[11px]">{prov.explanation}</p>
              <div className="font-mono text-[10px] text-zinc-500 truncate">
                Source: {prov.dataSource}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
