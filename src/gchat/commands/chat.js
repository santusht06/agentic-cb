// Google Chat Command Handlers

import pc from 'picocolors';
import { GoogleChatClient } from '../client.js';
import { outputJSON } from '../../formatter.js';

export function registerGoogleChatCommands(gchatCmd) {
  // 1. Login / Authenticate Google
  gchatCmd
    .command('login')
    .aliases(['auth', 'signin'])
    .description('Authenticate Google Chat in visible browser window (saved permanently)')
    .action(async () => {
      const client = new GoogleChatClient({
        attach: gchatCmd.parent.opts().attach,
        port: gchatCmd.parent.opts().port,
      });
      try {
        await client.login();
      } catch (err) {
        console.error(pc.red(`Google login error: ${err.message}`));
      }
    });

  // 2. List Conversations (DMs & Spaces)
  gchatCmd
    .command('list')
    .aliases(['chats', 'spaces'])
    .description('List recent Google Chat DMs and Spaces')
    .option('-l, --limit <number>', 'Number of conversations to fetch', 10)
    .action(async (cmdOpts) => {
      const client = new GoogleChatClient({
        attach: gchatCmd.parent.opts().attach,
        port: gchatCmd.parent.opts().port,
      });
      try {
        const convos = await client.getConversations(parseInt(cmdOpts.limit, 10));
        if (gchatCmd.parent.opts().json) {
          outputJSON({ ok: true, count: convos.length, conversations: convos });
        } else {
          console.log('\n' + pc.bold(pc.bgBlue(pc.white(' 💬 Google Chat Conversations '))) + '\n');
          if (convos.length === 0) {
            console.log(pc.dim('No active conversations found.'));
            return;
          }

          convos.forEach((c, idx) => {
            const unreadTag = c.isUnread ? pc.bold(pc.yellow(' [UNREAD]')) : '';
            console.log(`  ${pc.bold(pc.green(`[#${idx + 1}]`))} ${pc.bold(pc.white(c.name))}${unreadTag}`);
            if (c.snippet) console.log(`      ${pc.dim(c.snippet)}`);
            console.log('');
          });
        }
      } catch (err) {
        if (gchatCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Chat error: ${err.message}`));
      } finally {
        await client.close();
      }
    });

  // 3. Send Message
  gchatCmd
    .command('send <target> <message>')
    .description('Send message to a contact or Space in Google Chat')
    .action(async (target, message) => {
      const client = new GoogleChatClient({
        attach: gchatCmd.parent.opts().attach,
        port: gchatCmd.parent.opts().port,
      });
      try {
        console.log(pc.cyan(`Sending Google Chat message to "${target}"...`));
        const res = await client.sendMessage(target, message);
        if (gchatCmd.parent.opts().json) {
          outputJSON(res);
        } else {
          console.log('\n' + pc.bold(pc.green(`✓ Google Chat message sent to ${target} successfully!`)));
          console.log(pc.cyan(`Payload: "${message}"\n`));
        }
      } catch (err) {
        if (gchatCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Send error: ${err.message}`));
      } finally {
        await client.close();
      }
    });

  // 4. Read Message History
  gchatCmd
    .command('read <target>')
    .description('Read recent messages in a Google Chat conversation')
    .option('-l, --limit <number>', 'Number of messages to retrieve', 10)
    .action(async (target, cmdOpts) => {
      const client = new GoogleChatClient({
        attach: gchatCmd.parent.opts().attach,
        port: gchatCmd.parent.opts().port,
      });
      try {
        const history = await client.readMessages(target, parseInt(cmdOpts.limit, 10));
        if (gchatCmd.parent.opts().json) {
          outputJSON({ ok: true, ...history });
        } else {
          console.log('\n' + pc.bold(pc.bgBlue(pc.white(` 💬 Google Chat: ${target} (${history.count} messages) `))) + '\n');
          if (history.messages.length === 0) {
            console.log(pc.dim('No message bubbles located in thread.'));
            return;
          }

          history.messages.forEach((m) => {
            console.log(`  ${pc.bold(pc.cyan(m.author))}:`);
            console.log(`    ${m.text}\n`);
          });
        }
      } catch (err) {
        if (gchatCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Read error: ${err.message}`));
      } finally {
        await client.close();
      }
    });
}
