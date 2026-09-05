// Identity & Profile Command Handlers (100% Server Response Driven)

import pc from "picocolors";
import { LinkedInClient } from "../client.js";
import { outputJSON } from "../../formatter.js";

export function registerIdentityCommands(linkedinCmd) {
  // 1. Me / Identity (Pure Server API - < 80ms)
  linkedinCmd
    .command("me")
    .description("Fetch authenticated member profile and stats (Pure Server API)")
    .action(async () => {
      const client = new LinkedInClient();
      try {
        const data = await client.getMe();
        const mini = data.data?.miniProfile || data.miniProfile || {};
        
        if (linkedinCmd.parent.opts().json) {
          outputJSON({ ok: true, profile: mini });
        } else {
          console.log("\n" + pc.bold(pc.bgCyan(pc.black(" 👤 Authenticated Member Profile (Server Verified) "))) + "\n");
          console.log(`  ${pc.bold("Name:")}       ${mini.firstName} ${mini.lastName}`);
          console.log(`  ${pc.bold("Headline:")}   ${pc.cyan(mini.occupation)}`);
          console.log(`  ${pc.bold("Identifier:")} ${mini.publicIdentifier}`);
          console.log(`  ${pc.bold("Member URN:")}  ${pc.dim(mini.entityUrn)}`);
          console.log(`  ${pc.bold("Premium:")}     ${data.premiumSubscriber ? "Yes" : "No"}\n`);
        }
      } catch (err) {
        if (linkedinCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Identity error: ${err.message}`));
      }
    });

  // 2. Profile Viewers (Pure Server API - < 100ms)
  linkedinCmd
    .command("viewers")
    .aliases(["analytics", "views"])
    .description("List recent profile viewers directly from LinkedIn Server Analytics API")
    .action(async () => {
      const client = new LinkedInClient();
      try {
        const data = await client.getViewers();
        if (linkedinCmd.parent.opts().json) {
          outputJSON({ ok: true, ...data });
        } else {
          console.log("\n" + pc.bold(pc.bgCyan(pc.black(` ⚡ Profile Views: ${data.totalViews} total (${data.percentChange >= 0 ? "+" : ""}${data.percentChange}%) `))) + "\n");
          
          console.log(pc.bold("Server-Verified Viewers:"));
          data.viewers.forEach((v, idx) => {
            console.log(`  ${pc.bold(pc.green(`[#${idx + 1}]`))} ${pc.bold(pc.white(v.name))} ${pc.dim(`(${v.distance})`)}`);
            console.log(`      ${pc.dim(v.headline)}`);
            if (v.publicIdentifier) console.log(`      ${pc.dim("https://www.linkedin.com/in/" + v.publicIdentifier)}`);
            console.log("");
          });

          if (data.insights.length > 0) {
            console.log(pc.bold("Traffic Sources & Clusters:"));
            data.insights.forEach((i) => {
              console.log(`  • ${i.category}: ${pc.cyan(i.source || ("ID: " + i.companyId))} (${i.count} views)`);
            });
            console.log("");
          }
        }
      } catch (err) {
        if (linkedinCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Viewers error: ${err.message}`));
      }
    });

  // 3. Profile Inspect (Pure Server API)
  linkedinCmd
    .command("profile <identifier>")
    .description("Inspect any user profile by username or member ID via Server API")
    .action(async (identifier) => {
      const client = new LinkedInClient();
      try {
        const data = await client.getProfile(identifier);
        if (linkedinCmd.parent.opts().json) {
          outputJSON({ ok: true, identifier, data });
        } else {
          console.log("\n" + pc.bold(pc.bgCyan(pc.black(` 🔍 Profile Server Data: ${identifier} `))) + "\n");
          console.dir(data, { depth: 3, colors: true });
        }
      } catch (err) {
        if (linkedinCmd.parent.opts().json) outputJSON({ ok: false, error: err.message });
        else console.error(pc.red(`Profile error: ${err.message}`));
      }
    });
}
