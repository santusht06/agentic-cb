// CLI Controller & Command Definitions for Agentic CLI Browser

import { Command } from 'commander';
import pc from 'picocolors';
import readline from 'readline';
import fs from 'fs';
import { exec } from 'child_process';
import { BrowserRuntime } from './runtime.js';
import { sessionFetch } from './session.js';
import {
  renderNavigationResult,
  renderSemanticSnapshot,
  renderCookies,
  renderProfiles,
  outputJSON,
} from './formatter.js';
import { POLICY_STATUS } from './policy.js';

// Application Clients
import { LinkedInClient } from './linkedin/client.js';
import { WhatsAppClient } from './whatsapp/client.js';
import { GoogleChatClient } from './gchat/client.js';

// Application Command Modules
import { registerIdentityCommands } from './linkedin/commands/identity.js';
import { registerMessagingCommands } from './linkedin/commands/messaging.js';
import { registerFeedCommands } from './linkedin/commands/feed.js';
import { registerSearchCommands } from './linkedin/commands/search.js';
import { registerNetworkCommands } from './linkedin/commands/network.js';

import { registerChatCommands } from './whatsapp/commands/chats.js';
import { registerMessageCommands as registerWhatsAppMessageCommands } from './whatsapp/commands/messages.js';

import { registerGoogleChatCommands } from './gchat/commands/chat.js';

export function createCLI() {
  const program = new Command();

  program
    .name('cb')
    .description('Agentic CLI Browser — Centralized multi-application control plane for AI agents & developers')
    .version('1.0.0')
    .option('-j, --json', 'Output machine-readable JSON for agent consumption', false)
    .option('-p, --profile <name>', 'Browser session identity profile', 'default')
    .option('--attach', 'Attach directly to running native Google Chrome (CDP port 9222)', false)
    .option('--port <number>', 'Remote debugging port for Chrome attachment', 9222);

  // ==========================================
  // ⚡ 1. GLOBAL UNIFIED SEND ENGINE
  // ==========================================
  program
    .command('send <platform> <recipient> <message>')
    .description('Universal cross-platform message dispatcher (platforms: linkedin, gchat, wa)')
    .action(async (platform, recipient, message) => {
      const opts = program.opts();
      const p = platform.toLowerCase();

      try {
        console.log(pc.cyan(`\nDispatching message to "${recipient}" on ${p.toUpperCase()}...`));
        let res;

        if (p === 'gchat' || p === 'chat' || p === 'google') {
          const client = new GoogleChatClient({ attach: opts.attach, port: opts.port });
          res = await client.sendMessage(recipient, message);
          await client.close();
        } else if (p === 'linkedin' || p === 'li' || p === 'ldin') {
          const client = new LinkedInClient();
          res = await client.sendMessage(recipient, message);
        } else if (p === 'whatsapp' || p === 'wa') {
          const client = new WhatsAppClient({ attach: opts.attach, port: opts.port });
          res = await client.sendMessage(recipient, message);
          await client.close();
        } else {
          throw new Error(`Unsupported platform '${platform}'. Choose from: linkedin, gchat, wa`);
        }

        if (opts.json) {
          outputJSON({ ok: true, platform: p, ...res });
        } else {
          console.log(pc.bold(pc.green(`✓ Message successfully delivered to ${recipient} on ${p.toUpperCase()}!`)));
          console.log(pc.dim(`Payload: "${message}"\n`));
        }
      } catch (err) {
        if (opts.json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Send error [${platform}]: ${err.message}`));
      }
    });

  // ==========================================
  // 🚀 2. LINKEDIN SUITE
  // ==========================================
  const linkedinCmd = program
    .command('linkedin')
    .aliases(['li', 'ldin'])
    .description('LinkedIn control plane (Identity, Viewers, Messages, Search, Network)');

  registerIdentityCommands(linkedinCmd);
  registerMessagingCommands(linkedinCmd);
  registerFeedCommands(linkedinCmd);
  registerSearchCommands(linkedinCmd);
  registerNetworkCommands(linkedinCmd);

  // ==========================================
  // 📱 3. WHATSAPP SUITE
  // ==========================================
  const waCmd = program
    .command('wa')
    .aliases(['whatsapp'])
    .description('WhatsApp Web control plane (Chats, Unread, Read, Send)');

  registerChatCommands(waCmd);
  registerWhatsAppMessageCommands(waCmd);

  // ==========================================
  // 💬 4. GOOGLE CHAT SUITE
  // ==========================================
  const gchatCmd = program
    .command('gchat')
    .aliases(['chat', 'googlechat'])
    .description('Google Chat control plane (DMs, Spaces, Send, Read)');

  registerGoogleChatCommands(gchatCmd);

  // ==========================================
  // 🔑 5. INTERACTIVE LOGIN SESSION
  // ==========================================
  program
    .command('login <url>')
    .description('Launch visible browser window to log in and save cookies to profile')
    .action(async (url) => {
      const opts = program.opts();
      console.log(pc.bold(pc.bgGreen(pc.black(` 🔑 Opening login session for profile: ${opts.profile} `))));
      console.log(pc.cyan(`Target: ${url}`));
      console.log(pc.dim('Log in manually in the browser window. When finished, return here and press Enter.\n'));

      const runtime = new BrowserRuntime({ headless: false, profile: opts.profile });
      try {
        await runtime.navigate(url, { force: true });
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        await new Promise((resolve) => rl.question(pc.bold(pc.yellow('Press Enter after you complete login... ')), resolve));
        rl.close();

        const cookies = await runtime.getCookies();
        console.log(pc.bold(pc.green(`\n✓ Saved ${cookies.cookies.length} session cookies to profile '${opts.profile}'.\n`)));
      } catch (err) {
        console.error(pc.red(`Login error: ${err.message}`));
      } finally {
        await runtime.close();
      }
    });

  // ==========================================
  // 🚀 6. NATIVE CHROME BRIDGE STARTER
  // ==========================================
  program
    .command('chrome:start')
    .description('Launch native Google Chrome with remote debugging on port 9222')
    .option('--port <number>', 'Debugging port', 9222)
    .action((cmdOpts) => {
      const port = cmdOpts.port || 9222;
      console.log(pc.bold(pc.bgCyan(pc.black(` 🚀 Starting Native Google Chrome on port ${port} `))));
      const cmdStr = `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=${port} --restore-last-session &`;
      exec(cmdStr, (err) => {
        if (err) {
          console.error(pc.red(`Failed starting Google Chrome: ${err.message}`));
        }
      });
      console.log(pc.green(`✓ Google Chrome launched with CDP debugging active on port ${port}!`));
      console.log(pc.cyan(`\nYou can now control your live Chrome tabs with:\n  cb --attach send gchat "Jane Doe" "Hello"\n`));
    });

  // Open URL
  program
    .command('open <url>')
    .description('Navigate to a URL')
    .option('--headed', 'Launch visible browser mode', false)
    .option('--force', 'Bypass robots.txt policy', false)
    .action(async (url, options) => {
      const opts = program.opts();
      const runtime = new BrowserRuntime({
        headless: !options.headed,
        profile: opts.profile,
        attach: opts.attach,
        port: opts.port,
      });
      try {
        const result = await runtime.navigate(url, { force: options.force });
        if (opts.json) outputJSON(result);
        else renderNavigationResult(result, false);
      } catch (err) {
        if (opts.json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Error: ${err.message}`));
      } finally {
        await runtime.close();
      }
    });

  // Dump Semantic Tree
  program
    .command('dump [url]')
    .description('Display semantic accessibility tree of a URL or current page')
    .action(async (url) => {
      const opts = program.opts();
      const runtime = new BrowserRuntime({ headless: true, profile: opts.profile, attach: opts.attach, port: opts.port });
      try {
        await runtime.init();
        if (url) {
          await runtime.currentPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await runtime.currentPage.waitForSelector('body', { timeout: 5000 }).catch(() => {});
        }
        const snapshot = await runtime.getSemanticSnapshot();
        renderSemanticSnapshot(snapshot, opts.json);
      } catch (err) {
        if (opts.json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Error: ${err.message}`));
      } finally {
        await runtime.close();
      }
    });


  // ==========================================
  // 🌐 7. UNIVERSAL API FETCH (Agent-friendly)
  // ==========================================
  program
    .command('fetch <method> <url> [body]')
    .description('Make an authenticated HTTP request using stored session cookies (no browser launch)')
    .option('-H, --header <header>', 'Extra header in Key:Value format', (v, prev) => prev.concat([v]), [])
    .action(async (method, url, body, cmdOpts) => {
      const opts = program.opts();
      const profile = opts.profile || 'default';
      const extraHeaders = {};
      (cmdOpts.header || []).forEach((h) => {
        const [k, ...v] = h.split(':');
        if (k) extraHeaders[k.trim()] = v.join(':').trim();
      });
      let parsedBody = null;
      if (body) {
        try { parsedBody = JSON.parse(body); } catch { parsedBody = body; }
      }
      try {
        const result = await sessionFetch(profile, url, {
          method: method.toUpperCase(),
          body: parsedBody,
          headers: extraHeaders,
        });
        outputJSON(result);
        if (!result.ok) process.exitCode = 1;
      } catch (err) {
        if (opts.json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red('fetch error: ' + err.message));
        process.exitCode = 1;
      }
    });

  return program;
}
