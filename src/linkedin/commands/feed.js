// Feed & Post Command Handlers

import pc from 'picocolors';
import { LinkedInClient } from '../client.js';
import { outputJSON } from '../../formatter.js';

export function registerFeedCommands(linkedinCmd) {
  // 1. Feed List
  linkedinCmd
    .command('feed')
    .description('Fetch and display latest posts from your LinkedIn feed')
    .option('-l, --limit <number>', 'Number of posts to fetch', 5)
    .action(async (cmdOpts) => {
      const client = new LinkedInClient();
      try {
        const posts = await client.getFeed(parseInt(cmdOpts.limit, 10));
        if (linkedinCmd.parent.opts().json) {
          outputJSON({ ok: true, count: posts.length, posts });
        } else {
          console.log('\n' + pc.bold(pc.bgCyan(pc.black(' 📰 LinkedIn Feed Updates '))) + '\n');
          if (posts.length === 0) {
            console.log(pc.dim('No feed updates found.'));
            return;
          }
          posts.forEach((p, idx) => {
            console.log(`  ${pc.bold(pc.green(`[#${idx + 1}]`))} ${pc.bold(pc.white(p.author))} ${p.headline ? pc.dim(`• ${p.headline}`) : ""}`);
            console.log(`      ${p.text}`);
            console.log(`      ${pc.dim(`👍 ${p.likes} likes • 💬 ${p.comments} comments`)}`);
            console.log('');
          });
        }
      } catch (err) {
        if (linkedinCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Feed error: ${err.message}`));
      }
    });

  // 2. Publish Post
  linkedinCmd
    .command('post <text>')
    .description('Publish a new post to your LinkedIn profile feed')
    .action(async (text) => {
      const client = new LinkedInClient();
      try {
        console.log(pc.cyan(`Publishing post to LinkedIn feed: "${text}"...`));
        const res = await client.createPost(text);
        if (linkedinCmd.parent.opts().json) {
          outputJSON(res);
        } else {
          console.log(pc.bold(pc.green('\n🎉 SUCCESS: Post published to your LinkedIn feed!\n')));
        }
      } catch (err) {
        if (linkedinCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Post creation error: ${err.message}`));
      }
    });
}
