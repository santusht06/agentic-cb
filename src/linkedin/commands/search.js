// Search Command Handlers

import pc from 'picocolors';
import { LinkedInClient } from '../client.js';
import { outputJSON } from '../../formatter.js';

export function registerSearchCommands(linkedinCmd) {
  linkedinCmd
    .command('search <query>')
    .description('Search LinkedIn for people, jobs, companies, or posts')
    .option('-t, --type <type>', 'Search category: people, jobs, companies, posts', 'people')
    .option('-l, --limit <number>', 'Number of results to fetch', 5)
    .action(async (query, cmdOpts) => {
      const client = new LinkedInClient();
      try {
        const results = await client.search(query, cmdOpts.type, parseInt(cmdOpts.limit, 10));
        if (linkedinCmd.parent.opts().json) {
          outputJSON({ ok: true, query, type: cmdOpts.type, count: results.length, results });
        } else {
          console.log('\n' + pc.bold(pc.bgCyan(pc.black(` 🔍 LinkedIn Search: "${query}" (${cmdOpts.type}) `))) + '\n');
          if (results.length === 0) {
            console.log(pc.dim('No search results found.'));
            return;
          }
          results.forEach((r, idx) => {
            console.log(`  ${pc.bold(pc.green(`[#${idx + 1}]`))} ${pc.bold(pc.white(r.title))}`);
            if (r.subtitle) console.log(`      ${r.subtitle}`);
            if (r.secondary) console.log(`      ${pc.dim(r.secondary)}`);
            if (r.link) console.log(`      ${pc.dim(r.link)}`);
            console.log('');
          });
        }
      } catch (err) {
        if (linkedinCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Search error: ${err.message}`));
      }
    });
}
