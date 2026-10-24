import { getDatabasePath, getProjects, getRepositories, getAgentSessions } from '../lib/db';
import { antigravityConnector } from '../lib/connectors';
import { syncAllRepositories } from '../lib/github';
import { scanDevelopmentProcesses, getSystemPerformanceOverview } from '../lib/processes';
import { getUsageSummary } from '../lib/usage';

async function main() {
  console.log('=== DevScope Environment & Connector Diagnostics ===');
  console.log('Database Path:', getDatabasePath());

  const agyDiag = await antigravityConnector.discoverAndSync();
  console.log('\n[1] Antigravity Connector:');
  console.log('  Status:', agyDiag.status);
  console.log('  CLI Binary:', agyDiag.cliBinaryPath, `(${agyDiag.cliVersion})`);
  console.log('  Active Surfaces:', agyDiag.activeSurfaces.join(', '));
  console.log('  Total Sessions Discovered:', agyDiag.sessionCount, `(Active locked: ${agyDiag.activeSessionCount})`);

  const gitSync = await syncAllRepositories({ forceRemote: false });
  console.log('\n[2] GitHub & Local Git Integration:');
  console.log('  Authenticated:', gitSync.auth.authenticated, `via ${gitSync.auth.source} (${gitSync.auth.username || 'N/A'})`);
  console.log('  Local Repositories Discovered:', gitSync.repositories.length);

  const procs = scanDevelopmentProcesses();
  const perf = getSystemPerformanceOverview();
  console.log('\n[3] OS Process & Performance Monitor:');
  console.log('  CPU:', perf.cpuModel, `(${perf.cpuCores} cores)`);
  console.log('  Dev Processes Observed:', procs.length);

  const usage = getUsageSummary({ range: 'all' });
  console.log('\n[4] AI Model Usage & Cost Accounting:');
  console.log('  Measured Model Turns:', usage.totals.requestCount);
  console.log('  Measured Total Tokens:', usage.totals.totalTokens);
  console.log('  Estimated Cost (USD):', usage.totals.estimatedCostUsd ?? 'Pricing unexposed');
  console.log('  Reported Billing Cost:', usage.totals.reportedCostUsd ?? 'Unavailable from this source');

  console.log('\n[5] Stored Entities Summary:');
  console.log('  Projects:', getProjects({ includeExcluded: true }).length);
  console.log('  Repositories:', getRepositories().length);
  console.log('  Agent Sessions:', getAgentSessions({ limit: 100 }).length);
}

main().catch((err) => {
  console.error('Diagnostics failed:', err);
  process.exit(1);
});
