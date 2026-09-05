// Network & Connections Command Handlers (Pure Server API)

import pc from 'picocolors';
import { LinkedInClient } from '../client.js';
import { outputJSON } from '../../formatter.js';

export function registerNetworkCommands(linkedinCmd) {
  const net = linkedinCmd.command('network').aliases(['connections', 'net']).description('Manage connections and network');

  net
    .command('list')
    .description('List your recent LinkedIn connections directly from Server API')
    .option('-l, --limit <number>', 'Number of connections to fetch', 10)
    .action(async (cmdOpts) => {
      const client = new LinkedInClient();
      try {
        const connections = await client.getConnections(parseInt(cmdOpts.limit, 10));
        if (linkedinCmd.parent.opts().json) {
          outputJSON({ ok: true, count: connections.length, connections });
        } else {
          console.log('\n' + pc.bold(pc.bgCyan(pc.black(' 👥 LinkedIn Connections (Server Verified) '))) + '\n');
          if (connections.length === 0) {
            console.log(pc.dim('No connections found.'));
            return;
          }
          connections.forEach((c, idx) => {
            console.log(`  ${pc.bold(pc.green(`[#${idx + 1}]`))} ${pc.bold(pc.white(c.name))} ${pc.dim(`• ${c.connectedAgo}`)}`);
            if (c.occupation) console.log(`      ${pc.dim(c.occupation)}`);
            if (c.publicIdentifier) console.log(`      ${pc.dim('https://www.linkedin.com/in/' + c.publicIdentifier)}`);
            console.log('');
          });
        }
      } catch (err) {
        if (linkedinCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Network error: ${err.message}`));
      }
    });
}
