"use client";

import type { BusinessReconciliation } from "@/lib/business";

function nextStep(hold: string) {
  if (/seed list/i.test(hold)) return "Read back seed-list membership, sending provider and current hourly/per-second limits. Save the provider response and time checked.";
  if (/Agency:/i.test(hold)) return "Compare source files, writer output and the live loader/import counts. Reconcile the 900 and 461 reported counts before enabling the loader.";
  if (/Flagship:/i.test(hold)) return "Read actual sender allocation, inbox health and daily limits in the provider. Keep rejected and NO-SEND pools excluded; document which capacity is usable.";
  if (/routine/i.test(hold)) return "Inventory every bot’s enabled routines, schedules and last runs. Identify reply and health routines separately from campaign sending routines.";
  if (/Tony|invite/i.test(hold)) return "Read the actual calendar event, booking result and invitation-delivery evidence. Establish what failed before proposing a retry.";
  if (/Sent|unsent/i.test(hold)) return "Check the provider’s Sent folder and message IDs for the recipient and date. Resolve the delivery status before proposing any resend.";
  if (/DMARC|capture page/i.test(hold)) return "Inspect the live page and current DNS records. Compare them with the proposed change and record what is actually deployed.";
  if (/forwarding|redirect rule/i.test(hold)) return "Recover the exact rule from the mailbox provider or its configuration export. Record its conditions and destination before changing anything.";
  return "Obtain a current readback from the relevant provider, reconcile it with this report, and record evidence plus the remaining decision.";
}

export function LaunchChecklist({ info, onPrepare }: { info: BusinessReconciliation; onPrepare: (goal: string) => void }) {
  return <div className="space-y-3">
    <div className="rounded-xl border bg-white p-4">
      <h3 className="font-semibold">Campaign readiness checklist</h3>
      <p className="mt-2 text-sm">These items track provider verification and campaign approvals. Research and draft tasks can continue while they are open.</p>
      <p className="mt-2 text-xs text-[#6B6B6B]">{info.limitations}</p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs">
        <li>Collect current provider evidence for the checks below.</li>
        <li>For each campaign, finalize the offer, live links, eligible audience and exact copy; obtain independent copy review and delivery/seed clearance.</li>
        <li>Review the operator’s final readback, then record your explicit GO for that campaign and its limits.</li>
      </ol>
      <p className="mt-3 text-xs text-[#6B6B6B]">Preparing a verification task fills the queue form for your review. It does not start a task, send messages, enable schedules or grant launch approval.</p>
    </div>
    {info.holds.map((hold, i) => <article key={hold} className="rounded-xl border bg-white p-4">
      <span className="text-[11px] font-medium text-amber-800">Check {i + 1} · evidence needed</span>
      <p className="mt-2 text-sm">{hold}</p>
      <p className="mt-2 text-xs text-[#6B6B6B]"><strong>Next step:</strong> {nextStep(hold)}</p>
      <button className="mt-3 rounded-lg border px-3 py-2 text-xs hover:bg-[#F5F5F3]" onClick={() => onPrepare(`Perform a read-only verification of this open campaign check:\n${hold}\n\n${nextStep(hold)}\n\nReturn dated provider evidence, confirmed facts, unresolved gaps and the next decision needed. Do not send messages or invitations, retry deliveries, change DNS/settings, enable schedules, purchase anything or launch campaigns. If access is unavailable, report exactly what access is missing.`)}>Prepare verification task</button>
    </article>)}
  </div>;
}
