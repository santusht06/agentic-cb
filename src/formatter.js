// Terminal Visualizer & Semantic Formatter for Agentic CLI Browser

import pc from 'picocolors';
import { POLICY_STATUS } from './policy.js';

export function outputJSON(data) {
  console.log(JSON.stringify(data, null, 2));
}

export function renderNavigationResult(result, isJSON = false) {
  if (isJSON) {
    outputJSON(result);
    return;
  }

  console.log('\n' + pc.bold(pc.bgCyan(pc.black(' 🌐 Agentic CLI Browser '))) + '\n');

  if (result.status === POLICY_STATUS.ALLOWED) {
    console.log(
      pc.bold(pc.green('🟢 [ALLOWED]')) +
        ' ' +
        pc.white(result.url) +
        ' ' +
        pc.dim(`(HTTP ${result.statusCode})`)
    );
    if (result.pageTitle) {
      console.log(pc.bold(pc.cyan(`📄 Title:`)) + ' ' + pc.white(result.pageTitle));
    }
    if (result.robotsPolicy) {
      console.log(pc.dim(`🛡️  Policy: ${result.robotsPolicy.reason}`));
    }
  } else if (result.status === POLICY_STATUS.CHALLENGE_DETECTED) {
    console.log(
      pc.bold(pc.yellow('🟡 [CHALLENGE DETECTED]')) +
        ' ' +
        pc.bold(pc.yellow(result.challengeType)) +
        '\n' +
        pc.yellow(`⚠️  ${result.description}`)
    );
    console.log(pc.dim(`URL: ${result.url}`));
    console.log(
      '\n' +
        pc.bold(pc.bgYellow(pc.black(' ✋ HUMAN INTERACTION REQUIRED '))) +
        '\n' +
        pc.white('This site requires an interactive verification/security challenge.\n') +
        pc.cyan('Run with --headed: cb open ' + result.url + ' --headed\n')
    );
  } else if (result.status === POLICY_STATUS.DISALLOWED_BY_ROBOTS) {
    console.log(
      pc.bold(pc.red('🔴 [BLOCKED BY POLICY]')) +
        ' ' +
        pc.red(`Disallowed by site's /robots.txt policy`)
    );
    console.log(pc.dim(`Target: ${result.url}`));
    console.log(pc.dim(`Reason: ${result.reason}`));
    console.log(pc.yellow(`\nTip: To override policy intentionally, use: cb open ${result.url} --force\n`));
  } else {
    console.log(pc.red(`❌ Navigation error: ${result.error || 'Unknown'}`));
  }
}

export function renderSemanticSnapshot(snapshot, isJSON = false) {
  if (isJSON) {
    outputJSON(snapshot);
    return;
  }

  console.log('\n' + pc.bold(pc.bgMagenta(pc.black(' 📋 Semantic Accessibility Tree '))) + '\n');
  console.log(pc.cyan(`Page: `) + pc.bold(snapshot.title) + pc.dim(` (${snapshot.url})`));

  if (snapshot.headings && snapshot.headings.length > 0) {
    console.log('\n' + pc.bold(pc.yellow('📌 Headings:')));
    snapshot.headings.forEach((h) => console.log('  ' + pc.dim(h)));
  }

  console.log('\n' + pc.bold(pc.yellow('🎯 Interactive Elements (Agent Targets):')));
  console.log(pc.dim('  Ref   Type / Role       Content / Value'));
  console.log(pc.dim('  ────  ────────────────  ──────────────────────────────'));

  if (!snapshot.interactiveElements || snapshot.interactiveElements.length === 0) {
    console.log(pc.dim('  (No interactive elements found on page)'));
    return;
  }

  snapshot.interactiveElements.slice(0, 40).forEach((el) => {
    const refTag = pc.bold(pc.green(el.ref.padEnd(5)));
    const roleType = pc.cyan(`[${el.tag}${el.type ? ':' + el.type : ''}]`.padEnd(16));
    const label = el.text ? pc.white(el.text) : pc.dim(el.href || '<empty>');
    console.log(`  ${refTag} ${roleType} ${label}`);
  });

  if (snapshot.interactiveElements.length > 40) {
    console.log(pc.dim(`\n  ... and ${snapshot.interactiveElements.length - 40} more elements`));
  }

  console.log(
    '\n' +
      pc.dim('💡 Usage: ') +
      pc.cyan('cb click @1') +
      pc.dim('  |  ') +
      pc.cyan('cb type @2 "search query"') +
      pc.dim('  |  ') +
      pc.cyan('cb eval "document.title"') +
      '\n'
  );
}

export function renderCookies(cookies, isJSON = false) {
  if (isJSON) {
    outputJSON({ ok: true, cookies });
    return;
  }

  console.log('\n' + pc.bold(pc.bgBlue(pc.black(' 🍪 Session Cookies '))) + '\n');
  if (cookies.length === 0) {
    console.log(pc.dim('No active session cookies found.'));
    return;
  }
  cookies.forEach((c) => {
    console.log(`  ${pc.bold(pc.cyan(c.name))}: ${pc.white(c.value.slice(0, 40))} ${pc.dim(`[${c.domain}]`)}`);
  });
  console.log(pc.dim(`\nTotal: ${cookies.length} active cookies\n`));
}

export function renderProfiles(profiles, isJSON = false) {
  if (isJSON) {
    outputJSON({ ok: true, profiles });
    return;
  }

  console.log('\n' + pc.bold(pc.bgCyan(pc.black(' 👤 Configured Browser Profiles '))) + '\n');
  profiles.forEach((p) => {
    console.log(`  • ${pc.bold(pc.cyan(p))}`);
  });
  console.log('\n');
}
