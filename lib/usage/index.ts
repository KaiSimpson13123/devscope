import {
  getUsageRecords,
  getSetting,
  setSetting,
  getProjects,
  getTasks,
  getAgentSessions,
  createNotification,
  type UsageRecordItem,
} from '@/lib/db';

export interface ModelPricingEntry {
  modelPattern: string;
  displayName: string;
  provider: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
}

export interface PricingTable {
  version: string;
  updatedAt: string;
  note: string;
  models: ModelPricingEntry[];
}

export const DEFAULT_PRICING_TABLE: PricingTable = {
  version: 'v2026.10',
  updatedAt: '2026-10-24',
  note: 'Configurable local reference pricing table for estimating token costs when provider billing APIs are not exposed.',
  models: [
    {
      modelPattern: 'gemini-4-argon',
      displayName: 'Gemini 4 Argon',
      provider: 'Google Antigravity',
      inputPerMillionUsd: 1.25,
      outputPerMillionUsd: 5.0,
      cachedInputPerMillionUsd: 0.31,
    },
    {
      modelPattern: 'gemini-3.8-flash',
      displayName: 'Gemini 3.8 Flash',
      provider: 'Google Antigravity',
      inputPerMillionUsd: 0.15,
      outputPerMillionUsd: 0.6,
      cachedInputPerMillionUsd: 0.04,
    },
    {
      modelPattern: 'claude-opus-5.5',
      displayName: 'Claude Opus 5.5',
      provider: 'Anthropic (via Antigravity)',
      inputPerMillionUsd: 15.0,
      outputPerMillionUsd: 75.0,
      cachedInputPerMillionUsd: 1.5,
    },
    {
      modelPattern: 'claude-sonnet-5.5',
      displayName: 'Claude Sonnet 5.5',
      provider: 'Anthropic (via Antigravity)',
      inputPerMillionUsd: 3.0,
      outputPerMillionUsd: 15.0,
      cachedInputPerMillionUsd: 0.3,
    },
    {
      modelPattern: 'gpt-oss-120b',
      displayName: 'GPT-OSS 120B',
      provider: 'OpenAI OSS (via Antigravity)',
      inputPerMillionUsd: 0.8,
      outputPerMillionUsd: 2.4,
      cachedInputPerMillionUsd: 0.2,
    },
    {
      modelPattern: 'gpt-4o',
      displayName: 'GPT-4o',
      provider: 'OpenAI',
      inputPerMillionUsd: 2.5,
      outputPerMillionUsd: 10.0,
      cachedInputPerMillionUsd: 1.25,
    },
  ],
};

export function getPricingTable(): PricingTable {
  return getSetting<PricingTable>('pricingVersion' as never, DEFAULT_PRICING_TABLE) &&
    typeof getSetting('pricingTable' as never, null) === 'object' &&
    getSetting('pricingTable' as never, null) !== null
    ? (getSetting('pricingTable' as never) as PricingTable)
    : DEFAULT_PRICING_TABLE;
}

export function updatePricingTable(table: PricingTable): void {
  setSetting('pricingTable', table);
  setSetting('pricingVersion', table.version);
}

/**
 * Matches a model name against the versioned pricing table.
 * Returns null if the model is "Not exposed" or unknown, so DevScope never invents a dollar figure
 * for unpriced or unexposed models.
 */
export function matchModelPricing(modelName: string, table = getPricingTable()): ModelPricingEntry | null {
  if (!modelName || modelName === 'Not exposed' || modelName === 'Unknown') {
    return null;
  }
  const normalized = modelName.toLowerCase().replace(/[\s_()]+/g, '-');
  for (const entry of table.models) {
    const pattern = entry.modelPattern.toLowerCase().replace(/[\s_()]+/g, '-');
    if (normalized.includes(pattern) || modelName.toLowerCase().includes(entry.displayName.toLowerCase())) {
      return entry;
    }
  }
  return null;
}

/**
 * Calculates estimated cost in USD from measured token counts.
 * Strictly returns null if pricing for the model is not found or if the model is not exposed.
 */
export function calculateEstimatedCostUsd(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  pricingTable?: PricingTable;
}): { estimatedCostUsd: number | null; pricingVersion: string; provider: string } {
  const table = params.pricingTable ?? getPricingTable();
  const entry = matchModelPricing(params.model, table);

  if (!entry) {
    return {
      estimatedCostUsd: null,
      pricingVersion: table.version,
      provider: 'Google Antigravity',
    };
  }

  const inputCost = (Math.max(0, params.inputTokens) / 1_000_000) * entry.inputPerMillionUsd;
  const outputCost = (Math.max(0, params.outputTokens) / 1_000_000) * entry.outputPerMillionUsd;
  const cachedCost = (Math.max(0, params.cachedTokens ?? 0) / 1_000_000) * entry.cachedInputPerMillionUsd;

  const totalCost = Number((inputCost + outputCost + cachedCost).toFixed(6));
  return {
    estimatedCostUsd: totalCost,
    pricingVersion: table.version,
    provider: entry.provider,
  };
}

export interface UsageProviderStatus {
  id: string;
  name: string;
  status: 'connected' | 'not_configured' | 'limitation_reported';
  dataSource: string;
  exposesTokens: boolean;
  exposesReportedBilling: boolean;
  explanation: string;
}

export function getUsageProviderStatuses(): UsageProviderStatus[] {
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('placeholder'));
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('placeholder'));

  return [
    {
      id: 'antigravity-local-transcripts',
      name: 'Antigravity Local Session Transcripts',
      status: 'connected',
      dataSource: '~/.gemini/antigravity-{cli,ide}/brain/<id>/.system_generated/logs/transcript.jsonl',
      exposesTokens: true,
      exposesReportedBilling: false,
      explanation:
        'Exposes measured input_tokens, output_tokens, and cache_read_tokens per PLANNER_RESPONSE step. Model identifier is exposed when <USER_SETTINGS_CHANGE> is present in session transcript; otherwise reported as "Not exposed". Direct dollar billing is not exposed by Antigravity local logs, so costs are calculated as clearly-labeled estimates when model pricing is known.',
    },
    {
      id: 'antigravity-cloud-billing',
      name: 'Antigravity Subscription Billing API',
      status: 'limitation_reported',
      dataSource: 'Local Language Server / CodeAssist Cache',
      exposesTokens: false,
      exposesReportedBilling: false,
      explanation:
        'Antigravity subscriptions do not expose an authenticated local billing/invoice API endpoint. Actual reported cost is displayed as "Unavailable from this source".',
    },
    {
      id: 'openai-usage-adapter',
      name: 'OpenAI Organization Usage Adapter',
      status: hasOpenAi ? 'connected' : 'not_configured',
      dataSource: hasOpenAi ? 'https://api.openai.com/v1/organization/usage' : 'Optional OPENAI_API_KEY in .env.local',
      exposesTokens: hasOpenAi,
      exposesReportedBilling: hasOpenAi,
      explanation: hasOpenAi
        ? 'Configured via local environment variable.'
        : 'Optional adapter. Set OPENAI_API_KEY in .env.local to query OpenAI organization usage.',
    },
    {
      id: 'anthropic-usage-adapter',
      name: 'Anthropic Workspaces Usage Adapter',
      status: hasAnthropic ? 'connected' : 'not_configured',
      dataSource: hasAnthropic ? 'https://api.anthropic.com/v1/organizations/usage' : 'Optional ANTHROPIC_API_KEY in .env.local',
      exposesTokens: hasAnthropic,
      exposesReportedBilling: hasAnthropic,
      explanation: hasAnthropic
        ? 'Configured via local environment variable.'
        : 'Optional adapter. Set ANTHROPIC_API_KEY in .env.local to query Anthropic workspace usage.',
    },
  ];
}

export type UsageRangePreset = 'session' | 'today' | '7d' | '30d' | 'all' | 'custom';

export interface UsageDashboardSummary {
  range: UsageRangePreset;
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
  records: UsageRecordItem[];
  providers: UsageProviderStatus[];
  pricingTable: PricingTable;
}

export function getUsageSummary(opts?: {
  range?: UsageRangePreset;
  since?: string;
  until?: string;
  projectId?: string;
}): UsageDashboardSummary {
  const range = opts?.range ?? '30d';
  const now = new Date();
  let since: string | undefined = opts?.since;
  const until: string | undefined = opts?.until;

  const sessions = getAgentSessions({ limit: 50 });
  const activeSession = sessions.find((s) => s.isLockedPresence || s.status === 'active') ?? sessions[0] ?? null;

  if (range === 'today') {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    since = startOfDay.toISOString();
  } else if (range === '7d') {
    since = new Date(now.getTime() - 7 * 86400 * 1000).toISOString();
  } else if (range === '30d') {
    since = new Date(now.getTime() - 30 * 86400 * 1000).toISOString();
  }

  const records = getUsageRecords({
    sessionId: range === 'session' && activeSession ? activeSession.id : undefined,
    projectId: opts?.projectId,
    since: range === 'session' || range === 'all' ? undefined : since,
    until,
  });

  const projectsMap = new Map(getProjects({ includeExcluded: true }).map((p) => [p.id, p.name]));
  const pricingTable = getPricingTable();

  let requestCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let totalTokens = 0;
  let estimatedCostSum = 0;
  let pricedRequestCount = 0;
  let unpricedRequestCount = 0;
  let reportedCostSum = 0;
  let hasReportedCost = false;

  const modelMap = new Map<
    string,
    {
      model: string;
      provider: string;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      totalTokens: number;
      estimatedCostSum: number;
      hasEstimate: boolean;
      reportedCostSum: number;
      hasReported: boolean;
    }
  >();

  const projectAggMap = new Map<
    string,
    {
      projectId: string;
      projectName: string;
      requestCount: number;
      totalTokens: number;
      estimatedCostSum: number;
      hasEstimate: boolean;
    }
  >();

  const dayMap = new Map<
    string,
    {
      date: string;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      requestCount: number;
    }
  >();

  for (const r of records) {
    requestCount += r.requestCount;
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    cachedTokens += r.cachedTokens;
    totalTokens += r.totalTokens;

    if (r.estimatedCostUsd !== null) {
      estimatedCostSum += r.estimatedCostUsd;
      pricedRequestCount += r.requestCount;
    } else {
      unpricedRequestCount += r.requestCount;
    }

    if (r.reportedCostUsd !== null) {
      reportedCostSum += r.reportedCostUsd;
      hasReportedCost = true;
    }

    // By Model
    const mKey = `${r.provider}::${r.model}`;
    const existingM = modelMap.get(mKey) ?? {
      model: r.model,
      provider: r.provider,
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      estimatedCostSum: 0,
      hasEstimate: false,
      reportedCostSum: 0,
      hasReported: false,
    };
    existingM.requestCount += r.requestCount;
    existingM.inputTokens += r.inputTokens;
    existingM.outputTokens += r.outputTokens;
    existingM.cachedTokens += r.cachedTokens;
    existingM.totalTokens += r.totalTokens;
    if (r.estimatedCostUsd !== null) {
      existingM.estimatedCostSum += r.estimatedCostUsd;
      existingM.hasEstimate = true;
    }
    if (r.reportedCostUsd !== null) {
      existingM.reportedCostSum += r.reportedCostUsd;
      existingM.hasReported = true;
    }
    modelMap.set(mKey, existingM);

    // By Project
    const pId = r.projectId || 'unassigned';
    const pName = r.projectId ? projectsMap.get(r.projectId) || r.projectId : 'Unassigned / Global Session';
    const existingP = projectAggMap.get(pId) ?? {
      projectId: pId,
      projectName: pName,
      requestCount: 0,
      totalTokens: 0,
      estimatedCostSum: 0,
      hasEstimate: false,
    };
    existingP.requestCount += r.requestCount;
    existingP.totalTokens += r.totalTokens;
    if (r.estimatedCostUsd !== null) {
      existingP.estimatedCostSum += r.estimatedCostUsd;
      existingP.hasEstimate = true;
    }
    projectAggMap.set(pId, existingP);

    // By Day
    const dayKey = r.timestamp.slice(0, 10);
    const existingD = dayMap.get(dayKey) ?? {
      date: dayKey,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      requestCount: 0,
    };
    existingD.inputTokens += r.inputTokens;
    existingD.outputTokens += r.outputTokens;
    existingD.cachedTokens += r.cachedTokens;
    existingD.totalTokens += r.totalTokens;
    existingD.estimatedCostUsd = Number((existingD.estimatedCostUsd + (r.estimatedCostUsd ?? 0)).toFixed(6));
    existingD.requestCount += r.requestCount;
    dayMap.set(dayKey, existingD);
  }

  const tasks = getTasks();
  const estimatedCostUsd = pricedRequestCount > 0 ? Number(estimatedCostSum.toFixed(4)) : null;
  const averageCostPerTaskUsd =
    estimatedCostUsd !== null && tasks.length > 0
      ? Number((estimatedCostUsd / tasks.length).toFixed(4))
      : null;

  // Threshold notification check
  const threshold = getSetting<number>('costThresholdUsd', 25.0);
  if (estimatedCostUsd !== null && estimatedCostUsd >= threshold) {
    createNotification({
      type: 'cost_threshold_exceeded',
      severity: 'warning',
      title: 'Estimated AI Usage Threshold Reached',
      message: `Estimated usage ($${estimatedCostUsd.toFixed(2)}) reached configured threshold ($${threshold.toFixed(2)}).`,
      link: '/usage',
    });
  }

  const sessionRecords = activeSession ? getUsageRecords({ sessionId: activeSession.id }) : [];
  let sessReq = 0;
  let sessIn = 0;
  let sessOut = 0;
  let sessCached = 0;
  let sessTotal = 0;
  let sessCost = 0;
  let sessHasCost = false;
  for (const sr of sessionRecords) {
    sessReq += sr.requestCount;
    sessIn += sr.inputTokens;
    sessOut += sr.outputTokens;
    sessCached += sr.cachedTokens;
    sessTotal += sr.totalTokens;
    if (sr.estimatedCostUsd !== null) {
      sessCost += sr.estimatedCostUsd;
      sessHasCost = true;
    }
  }

  return {
    range,
    pricingVersion: pricingTable.version,
    totals: {
      requestCount,
      inputTokens,
      outputTokens,
      cachedTokens,
      totalTokens,
      estimatedCostUsd,
      pricedRequestCount,
      unpricedRequestCount,
      reportedCostUsd: hasReportedCost ? Number(reportedCostSum.toFixed(4)) : null,
      averageCostPerTaskUsd,
    },
    currentSession: {
      sessionId: activeSession?.id ?? null,
      title: activeSession?.title ?? null,
      model: activeSession?.model ?? 'Not exposed',
      requestCount: sessReq,
      inputTokens: sessIn,
      outputTokens: sessOut,
      cachedTokens: sessCached,
      totalTokens: sessTotal,
      estimatedCostUsd: sessHasCost ? Number(sessCost.toFixed(4)) : null,
    },
    byModel: Array.from(modelMap.values())
      .map((m) => ({
        model: m.model,
        provider: m.provider,
        requestCount: m.requestCount,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cachedTokens: m.cachedTokens,
        totalTokens: m.totalTokens,
        estimatedCostUsd: m.hasEstimate ? Number(m.estimatedCostSum.toFixed(4)) : null,
        reportedCostUsd: m.hasReported ? Number(m.reportedCostSum.toFixed(4)) : null,
        pricingAvailable: m.hasEstimate,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    byProject: Array.from(projectAggMap.values())
      .map((p) => ({
        projectId: p.projectId,
        projectName: p.projectName,
        requestCount: p.requestCount,
        totalTokens: p.totalTokens,
        estimatedCostUsd: p.hasEstimate ? Number(p.estimatedCostSum.toFixed(4)) : null,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    byDay: Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    records: records.slice(0, 150),
    providers: getUsageProviderStatuses(),
    pricingTable,
  };
}
