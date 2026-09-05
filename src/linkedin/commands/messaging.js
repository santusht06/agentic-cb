// Messaging Command Handlers

import pc from 'picocolors';
import { LinkedInClient } from '../client.js';
import { outputJSON } from '../../formatter.js';

export function registerMessagingCommands(linkedinCmd) {
  const msg = linkedinCmd.command('msg').aliases(['messages', 'inbox']).description('LinkedIn messaging commands');

  // 1. List Messages
  msg
    .command('list')
    .description('List recent message threads')
    .option('-l, --limit <number>', 'Number of conversations to fetch', 10)
    .action(async (cmdOpts) => {
      const client = new LinkedInClient();
      try {
        const convos = await client.getConversations(parseInt(cmdOpts.limit, 10));
        if (linkedinCmd.parent.opts().json) {
          outputJSON({ ok: true, count: convos.length, conversations: convos });
        } else {
          console.log('\n' + pc.bold(pc.bgCyan(pc.black(' 💬 LinkedIn Inbox '))) + '\n');
          if (convos.length === 0) {
            console.log(pc.dim('No conversations found.'));
            return;
          }
          convos.forEach((c, idx) => {
            const unreadTag = c.unread ? pc.bold(pc.yellow(' [UNREAD]')) : '';
            console.log(`  ${pc.bold(pc.green(`[#${idx + 1}]`))} ${pc.bold(pc.white(c.name))}${unreadTag} ${pc.dim(`• ${c.time}`)}`);
            console.log(`      ${pc.dim(c.snippet.slice(0, 110) + (c.snippet.length > 110 ? '...' : ''))}`);
            console.log('');
          });
        }
      } catch (err) {
        if (linkedinCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Messaging error: ${err.message}`));
      }
    });

  // 2. Send Message
  msg
    .command('send <recipient> <message>')
    .description('Send direct message to a connection')
    .action(async (recipient, message) => {
      const client = new LinkedInClient();
      try {
        console.log(pc.cyan(`Transmitting message to "${recipient}"...`));
        const res = await client.sendMessage(recipient, message);
        if (linkedinCmd.parent.opts().json) {
          outputJSON(res);
        } else {
          console.log('\n' + pc.bold(pc.green(`✓ Message sent to ${recipient} successfully!`)));
          console.log(pc.cyan(`Payload: "${message}"\n`));
        }
      } catch (err) {
        if (linkedinCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Send error: ${err.message}`));
      }
    });
}
