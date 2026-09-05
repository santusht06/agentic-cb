// WhatsApp Messaging Command Handlers

import pc from 'picocolors';
import { WhatsAppClient } from '../client.js';
import { outputJSON } from '../../formatter.js';

export function registerMessageCommands(waCmd) {
  // 1. Send Direct Message
  waCmd
    .command('send <contact> <message>')
    .description('Send direct WhatsApp message to a contact or phone number')
    .action(async (contact, message) => {
      const client = new WhatsAppClient({
        attach: waCmd.parent.opts().attach,
        port: waCmd.parent.opts().port,
      });
      try {
        console.log(pc.cyan(`Transmitting WhatsApp message to "${contact}"...`));
        const res = await client.sendMessage(contact, message);
        if (waCmd.parent.opts().json) {
          outputJSON(res);
        } else {
          console.log('\n' + pc.bold(pc.green(`✓ WhatsApp message sent to ${contact} successfully!`)));
          console.log(pc.cyan(`Payload: "${message}"\n`));
        }
      } catch (err) {
        if (waCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Send error: ${err.message}`));
      } finally {
        await client.close();
      }
    });

  // 2. Read Chat History
  waCmd
    .command('read <contact>')
    .description('Read recent message history with a specific contact')
    .option('-l, --limit <number>', 'Number of messages to retrieve', 10)
    .action(async (contact, cmdOpts) => {
      const client = new WhatsAppClient({
        attach: waCmd.parent.opts().attach,
        port: waCmd.parent.opts().port,
      });
      try {
        const history = await client.readMessages(contact, parseInt(cmdOpts.limit, 10));
        if (waCmd.parent.opts().json) {
          outputJSON({ ok: true, ...history });
        } else {
          console.log('\n' + pc.bold(pc.bgGreen(pc.black(` 💬 Conversation: ${contact} (${history.count} messages) `))) + '\n');
          if (history.messages.length === 0) {
            console.log(pc.dim('No message bubbles located in thread.'));
            return;
          }

          history.messages.forEach((m) => {
            const senderTag = m.outgoing ? pc.bold(pc.green('You')) : pc.bold(pc.cyan(contact));
            console.log(`  ${senderTag} ${pc.dim(`• ${m.time}`)}`);
            console.log(`    ${m.text}\n`);
          });
        }
      } catch (err) {
        if (waCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Read error: ${err.message}`));
      } finally {
        await client.close();
      }
    });
}
