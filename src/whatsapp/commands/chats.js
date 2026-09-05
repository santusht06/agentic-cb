// WhatsApp Chat & Session Command Handlers

import pc from 'picocolors';
import { WhatsAppClient } from '../client.js';
import { outputJSON } from '../../formatter.js';

export function registerChatCommands(waCmd) {
  // 1. Login / Pair QR
  waCmd
    .command('login')
    .aliases(['auth', 'pair'])
    .description('Pair WhatsApp Web via QR code (saved permanently to profile)')
    .action(async () => {
      const client = new WhatsAppClient({
        attach: waCmd.parent.opts().attach,
        port: waCmd.parent.opts().port,
      });
      try {
        await client.login();
      } catch (err) {
        console.error(pc.red(`Pairing error: ${err.message}`));
      }
    });

  // 2. List Recent Chats
  waCmd
    .command('chats')
    .aliases(['list', 'inbox'])
    .description('List recent WhatsApp chats, last messages, and unread badges')
    .option('-l, --limit <number>', 'Number of chats to fetch', 10)
    .action(async (cmdOpts) => {
      const client = new WhatsAppClient({
        attach: waCmd.parent.opts().attach,
        port: waCmd.parent.opts().port,
      });
      try {
        const chats = await client.getChats(parseInt(cmdOpts.limit, 10));
        if (waCmd.parent.opts().json) {
          outputJSON({ ok: true, count: chats.length, chats });
        } else {
          console.log('\n' + pc.bold(pc.bgGreen(pc.black(' 📱 WhatsApp Recent Chats '))) + '\n');
          if (chats.length === 0) {
            console.log(pc.dim('No active chats found.'));
            return;
          }

          chats.forEach((c, idx) => {
            const unreadTag = c.isUnread ? pc.bold(pc.bgYellow(pc.black(` [${c.unreadCount} UNREAD] `))) : '';
            console.log(`  ${pc.bold(pc.green(`[#${idx + 1}]`))} ${pc.bold(pc.white(c.name))} ${unreadTag} ${pc.dim(`• ${c.time}`)}`);
            if (c.snippet) console.log(`      ${pc.dim(c.snippet)}`);
            console.log('');
          });
        }
      } catch (err) {
        if (waCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Chats error: ${err.message}`));
      } finally {
        await client.close();
      }
    });

  // 3. Filter Unread Messages
  waCmd
    .command('unread')
    .description('List only chats with unread messages')
    .action(async () => {
      const client = new WhatsAppClient({
        attach: waCmd.parent.opts().attach,
        port: waCmd.parent.opts().port,
      });
      try {
        const unread = await client.getUnread();
        if (waCmd.parent.opts().json) {
          outputJSON({ ok: true, count: unread.length, unread });
        } else {
          console.log('\n' + pc.bold(pc.bgYellow(pc.black(` 🔔 WhatsApp Unread Chats (${unread.length}) `))) + '\n');
          if (unread.length === 0) {
            console.log(pc.green('✓ All caught up! No unread messages.'));
            return;
          }

          unread.forEach((c, idx) => {
            console.log(`  ${pc.bold(pc.green(`[#${idx + 1}]`))} ${pc.bold(pc.white(c.name))} ${pc.bold(pc.yellow(`(${c.unreadCount} unread)`))} ${pc.dim(`• ${c.time}`)}`);
            if (c.snippet) console.log(`      ${pc.dim(c.snippet)}`);
            console.log('');
          });
        }
      } catch (err) {
        if (waCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Unread error: ${err.message}`));
      } finally {
        await client.close();
      }
    });
}
